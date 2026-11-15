import { describe, expect, it } from 'vitest';
import { createOperationRegistry } from '../registry.js';
import { adler32, crc32, hashingOperations, identifyHash, md5 } from './index.js';
import { bytesToHex } from '../bytes.js';

const registry = createOperationRegistry(hashingOperations);
const run = (id, input, options) => registry.execute(id, input, options);

describe('hashing', () => {
  it('computes SHA-2 digests with Web Crypto (NIST vectors)', async () => {
    expect(await run('hash.sha-256', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await run('hash.sha-384', 'abc')).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    );
    expect(await run('hash.sha-512', '')).toBe(
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    );
    expect(await run('hash.sha-256', 'abc', { format: 'base64' })).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });

  it('hashes Unicode as UTF-8', async () => {
    expect(await run('hash.sha-256', 'é')).toBe(await run('hash.sha-256', new Uint8Array([0xc3, 0xa9])));
    expect(await run('hash.sha-256', 'é')).not.toBe(await run('hash.sha-256', new Uint8Array([0xe9])));
  });

  it('computes MD5 and SHA-1 (insecure, labelled)', async () => {
    expect(bytesToHex(md5(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(bytesToHex(md5('The quick brown fox jumps over the lazy dog'))).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(bytesToHex(md5('a'.repeat(1000)))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
    expect(await run('hash.sha-1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(registry.get('hash.md5').insecure).toBe(true);
    expect(registry.get('hash.sha-1').insecure).toBe(true);
  });

  it('computes HMAC (RFC 4231 test case 2)', async () => {
    expect(await run('hash.hmac', 'what do ya want for nothing?', { key: 'Jefe' })).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('computes checksums', () => {
    expect(crc32('123456789').toString(16)).toBe('cbf43926');
    expect(adler32('Wikipedia').toString(16)).toBe('11e60398');
  });

  it('reports all hashes in one table', async () => {
    const report = await run('hash.all', 'abc');
    expect(report).toContain('| SHA-256 | ba7816bf');
    expect(report).toContain('| MD5 ⚠️ insecure | 900150983cd24fb0d6963f7d28e17f72 |');
    expect(report).toContain('| CRC-32 | 352441c2 |');
  });

  it('identifies hash types', async () => {
    expect(identifyHash('d41d8cd98f00b204e9800998ecf8427e')).toContain('MD5');
    expect(identifyHash('a'.repeat(64))).toContain('SHA-256');
    expect(identifyHash('$2b$12$' + 'a'.repeat(53))).toEqual(['bcrypt']);
    expect(await run('hash.identify', 'zzz')).toBe('Unknown hash format.');
  });

  it('declares hashes as one-way report operations', () => {
    for (const operation of registry.list) {
      expect(operation.outputMode).toBe('report');
      expect(operation.notes).toMatch(/one-way|guess/);
    }
  });
});
