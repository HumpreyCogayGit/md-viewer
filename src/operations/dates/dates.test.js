import { describe, expect, it } from 'vitest';
import { createOperationRegistry } from '../registry.js';
import {
  dateOperations,
  formatDate,
  formatDuration,
  formatIso,
  parseDate,
  parseDuration,
  relativeTime,
} from './index.js';

const registry = createOperationRegistry(dateOperations);
const run = (id, input, options) => registry.execute(id, input, options);

describe('Unix ↔ ISO', () => {
  it('auto-detects seconds and milliseconds', async () => {
    expect(await run('date.unix-to-iso', '0\n1700000000\n1700000000123')).toBe(
      '1970-01-01T00:00:00Z\n2023-11-14T22:13:20Z\n2023-11-14T22:13:20.123Z',
    );
  });

  it('formats in explicit IANA zones, including DST', async () => {
    expect(await run('date.unix-to-iso', '1700000000', { zone: 'Asia/Tokyo' })).toBe('2023-11-15T07:13:20+09:00');
    expect(await run('date.unix-to-iso', '1688169600', { zone: 'America/New_York' })).toBe('2023-06-30T20:00:00-04:00');
    expect(await run('date.unix-to-iso', '1700000000', { zone: 'America/New_York' })).toBe('2023-11-14T17:13:20-05:00');
    await expect(run('date.unix-to-iso', '1', { zone: 'Mars/Base' })).rejects.toThrow(/Unknown time zone/);
  });

  it('converts dates back to Unix time', async () => {
    expect(await run('date.iso-to-unix', '2023-11-14T22:13:20Z\n2023-11-15T07:13:20+09:00')).toBe(
      '1700000000\n1700000000',
    );
    expect(await run('date.iso-to-unix', '1970-01-01T00:00:01.5Z', { unit: 'ms' })).toBe('1500');
    expect(await run('date.iso-to-unix', '2024-03-10 02:30', { assume: 'America/New_York' })).toBe(
      String(Date.UTC(2024, 2, 10, 7, 30) / 1000),
    );
  });

  it('rejects invalid and ambiguous dates without output', async () => {
    await expect(run('date.iso-to-unix', 'not a date')).rejects.toThrow(/Unrecognized date/);
    await expect(run('date.iso-to-unix', '2024-02-30')).rejects.toThrow(/Invalid date/);
    await expect(run('date.iso-to-unix', '2024-13-01')).rejects.toThrow(/Invalid date/);
    await expect(run('date.iso-to-unix', '01/02/2024')).rejects.toThrow(/Ambiguous/);
    await expect(run('date.unix-to-iso', 'abc')).rejects.toThrow(/Not a Unix timestamp/);
  });

  it('resolves numeric date order when unambiguous or chosen', () => {
    expect(formatIso(parseDate('25/12/2024'))).toBe('2024-12-25T00:00:00Z');
    expect(formatIso(parseDate('01/02/2024', { order: 'DMY' }))).toBe('2024-02-01T00:00:00Z');
    expect(formatIso(parseDate('01/02/2024', { order: 'MDY' }))).toBe('2024-01-02T00:00:00Z');
  });
});

describe('normalize and format', () => {
  it('normalizes various inputs to ISO', async () => {
    expect(await run('date.normalize', 'Tue, 14 Nov 2023 22:13:20 GMT\n2023-11-14 22:13')).toBe(
      '2023-11-14T22:13:20Z\n2023-11-14T22:13:00Z',
    );
  });

  it('formats named and custom patterns', async () => {
    const date = parseDate('2023-11-14T22:13:20.045Z');
    expect(formatDate(date, 'YYYY-MM-DD [at] h:mm A ddd MMM SSS ZZ')).toBe('2023-11-14 at 10:13 PM Tue Nov 045 +0000');
    expect(await run('date.format', '2023-11-14T22:13:20Z', { format: 'rfc2822' })).toBe(
      'Tue, 14 Nov 2023 22:13:20 +0000',
    );
    expect(await run('date.format', '2023-11-14T22:13:20Z', { format: 'http' })).toBe('Tue, 14 Nov 2023 22:13:20 GMT');
    expect(
      await run('date.format', '2023-11-14T22:13:20Z', {
        format: 'custom',
        pattern: 'DD.MM.YY HH:mm',
        zone: 'Europe/Berlin',
      }),
    ).toBe('14.11.23 23:13');
  });

  it('inspects a date in several representations', async () => {
    const report = await run('date.inspect', '2023-11-14T22:13:20Z', { zone: 'Asia/Kolkata' });
    expect(report).toContain('| UTC | 2023-11-14T22:13:20Z |');
    expect(report).toContain('| Asia/Kolkata | 2023-11-15T03:43:20+05:30 |');
    expect(report).toContain('| Unix seconds | 1700000000 |');
    expect(await run('date.inspect', '2023-11-14 10:00')).toContain('No zone in input');
  });
});

describe('durations', () => {
  it('formats durations in several styles', async () => {
    expect(formatDuration(5_400_000)).toBe('1h 30m');
    expect(formatDuration(90_061_001, { style: 'long' })).toBe('1 day, 1 hour, 1 minute, 1 second, 1 millisecond');
    expect(formatDuration(5_400_000, { style: 'iso' })).toBe('PT1H30M');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-60000)).toBe('-1m');
    expect(await run('date.duration-format', '3661\n90m', { style: 'short' })).toBe('1h 1m 1s\n1h 30m');
  });

  it('parses human and ISO durations', () => {
    expect(parseDuration('1h 30m')).toBe(5_400_000);
    expect(parseDuration('2 days and 4 hours')).toBe(2 * 864e5 + 4 * 36e5);
    expect(parseDuration('P1DT2H')).toBe(864e5 + 2 * 36e5);
    expect(parseDuration('-90m')).toBe(-5_400_000);
    expect(parseDuration('45')).toBe(45_000);
    expect(() => parseDuration('soon')).toThrow(/Unrecognized duration/);
  });

  it('computes date differences and additions', async () => {
    expect(await run('date.delta', '2024-01-01\n---\n2024-01-02T12:00Z')).toContain('| Duration | 1 day, 12 hours |');
    expect(await run('date.add', '2024-01-31T00:00:00Z', { duration: '1d 2h' })).toBe('2024-02-01T02:00:00Z');
    expect(await run('date.add', '2024-01-31T00:00:00Z', { duration: '-P1W' })).toBe('2024-01-24T00:00:00Z');
  });
});

describe('FILETIME and relative time', () => {
  it('converts Windows FILETIME', async () => {
    expect(await run('date.filetime-to-iso', '116444736000000000')).toBe('1970-01-01T00:00:00Z');
    expect(await run('date.iso-to-filetime', '2023-11-14T22:13:20Z')).toBe('133444736000000000');
  });

  it('describes relative time', () => {
    const now = new Date('2024-01-10T00:00:00Z');
    expect(relativeTime(new Date('2024-01-09T00:00:00Z'), now)).toBe('yesterday');
    expect(relativeTime(new Date('2024-01-10T03:00:00Z'), now)).toBe('in 3 hours');
  });
});
