// Minimal DER/ASN.1 reader for inspecting PEM certificates, CSRs and keys. Inspection only — no chain or
// signature verification.
import { bytesToHex, utf8Decode } from '../bytes.js';
import { markdownTable, operationFactory } from '../define.js';
import { base64Decode } from '../encoding/codecs.js';
import { digest } from '../hashing/index.js';
import { formatIso } from '../dates/index.js';

export function readDer(bytes, offset = 0, depthLimit = 32) {
  if (depthLimit <= 0) throw new Error('ASN.1 nesting is too deep.');
  if (offset + 2 > bytes.length) throw new Error('Truncated ASN.1 data.');
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new Error('Unsupported ASN.1 length encoding.');
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[offset + 2 + i];
    header += count;
  }
  const start = offset + header;
  const end = start + length;
  if (end > bytes.length) throw new Error('ASN.1 length exceeds the data.');
  const node = { tag, start, end, header: offset, content: bytes.subarray(start, end), children: [] };
  const constructed = (tag & 0x20) !== 0;
  if (constructed) {
    let cursor = start;
    while (cursor < end) {
      const child = readDer(bytes, cursor, depthLimit - 1);
      node.children.push(child);
      cursor = child.end;
    }
  }
  return node;
}

export function decodeOid(bytes) {
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i += 1) {
    value = value * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

const OIDS = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.5': 'serialNumber',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.10045.2.1': 'EC',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.15': 'keyUsage',
  '2.5.29.37': 'extKeyUsage',
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.35': 'authorityKeyIdentifier',
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
};
const oidName = (oid) => OIDS[oid] || oid;

function decodeString(node) {
  if (node.tag === 0x1e) {
    let out = '';
    for (let i = 0; i + 1 < node.content.length; i += 2)
      out += String.fromCharCode((node.content[i] << 8) | node.content[i + 1]);
    return out;
  }
  return utf8Decode(node.content);
}

function decodeName(node) {
  return node.children
    .flatMap((set) => set.children)
    .map((attribute) => `${oidName(decodeOid(attribute.children[0].content))}=${decodeString(attribute.children[1])}`)
    .join(', ');
}

function decodeTime(node) {
  const text = utf8Decode(node.content);
  const match =
    node.tag === 0x17
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text)
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text);
  if (!match) return text;
  let year = Number(match[1]);
  if (node.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(
    Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)),
  );
}

function describeKey(spki) {
  const algorithm = decodeOid(spki.children[0].children[0].content);
  const name = oidName(algorithm);
  if (name === 'RSA') {
    const bitString = spki.children[1].content.subarray(1);
    const rsa = readDer(bitString);
    let modulus = rsa.children[0].content;
    while (modulus[0] === 0) modulus = modulus.subarray(1);
    return `RSA ${modulus.length * 8}-bit`;
  }
  if (name === 'EC') {
    const curve = spki.children[0].children[1];
    return `EC ${curve?.tag === 0x06 ? oidName(decodeOid(curve.content)) : ''}`.trim();
  }
  return name;
}

function decodeExtensions(node) {
  const rows = [];
  for (const extension of node.children) {
    const oid = oidName(decodeOid(extension.children[0].content));
    const critical =
      extension.children.length === 3 && extension.children[1].tag === 0x01 && extension.children[1].content[0] !== 0;
    const value = readDer(extension.children[extension.children.length - 1].content);
    let text;
    if (oid === 'subjectAltName') {
      text = value.children
        .map((name) => {
          const kind = name.tag & 0x1f;
          if (kind === 2) return `DNS:${utf8Decode(name.content)}`;
          if (kind === 1) return `email:${utf8Decode(name.content)}`;
          if (kind === 6) return `URI:${utf8Decode(name.content)}`;
          if (kind === 7)
            return `IP:${name.content.length === 4 ? Array.from(name.content).join('.') : bytesToHex(name.content).replace(/(.{4})(?!$)/g, '$1:')}`;
          return `[${kind}]`;
        })
        .join(', ');
    } else if (oid === 'basicConstraints') {
      const ca = value.children.find((child) => child.tag === 0x01);
      const pathLen = value.children.find((child) => child.tag === 0x02);
      text = `CA: ${ca && ca.content[0] ? 'true' : 'false'}${pathLen ? `, pathLen: ${pathLen.content[0]}` : ''}`;
    } else if (oid === 'extKeyUsage') {
      text = value.children.map((child) => oidName(decodeOid(child.content))).join(', ');
    } else if (oid === 'keyUsage') {
      const bits = value.content.length > 1 ? value.content[1] : 0;
      text = [
        'digitalSignature',
        'nonRepudiation',
        'keyEncipherment',
        'dataEncipherment',
        'keyAgreement',
        'keyCertSign',
        'cRLSign',
        'encipherOnly',
      ]
        .filter((_, i) => bits & (0x80 >> i))
        .join(', ');
    } else if (oid === 'subjectKeyIdentifier') {
      text = bytesToHex(value.content, ':');
    } else {
      text = `${value.content.length} bytes`;
    }
    rows.push([`${oid}${critical ? ' (critical)' : ''}`, text]);
  }
  return rows;
}

export function parsePemBlocks(text) {
  const blocks = Array.from(
    String(text).matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g),
    (match) => ({ label: match[1], der: base64Decode(match[2].replace(/[^A-Za-z0-9+/=]/g, '')) }),
  );
  if (blocks.length === 0) throw new Error('No PEM block (-----BEGIN …-----) found.');
  return blocks;
}

export async function inspectCertificate(der, now = new Date()) {
  const cert = readDer(der);
  const tbs = cert.children[0];
  let index = 0;
  const version = tbs.children[0].tag === 0xa0 ? tbs.children[index++].children[0].content[0] + 1 : 1;
  const serial = bytesToHex(tbs.children[index++].content, ':');
  const signatureAlgorithm = oidName(decodeOid(tbs.children[index++].children[0].content));
  const issuer = decodeName(tbs.children[index++]);
  const validity = tbs.children[index++];
  const notBefore = decodeTime(validity.children[0]);
  const notAfter = decodeTime(validity.children[1]);
  const subject = decodeName(tbs.children[index++]);
  const key = describeKey(tbs.children[index++]);
  const extensionsNode = tbs.children.slice(index).find((child) => child.tag === 0xa3);
  const status = notAfter < now ? '⚠️ expired' : notBefore > now ? '⚠️ not yet valid' : 'within validity period';
  const sha256 = bytesToHex(await digest('SHA-256', der), ':').toUpperCase();
  return [
    ['Subject', subject],
    ['Issuer', issuer],
    ['Version', `v${version}`],
    ['Serial', serial],
    ['Not before', notBefore instanceof Date ? formatIso(notBefore) : notBefore],
    ['Not after', notAfter instanceof Date ? formatIso(notAfter) : notAfter],
    ['Status', status],
    ['Public key', key],
    ['Signature algorithm', signatureAlgorithm],
    ['Self-signed', subject === issuer ? 'yes' : 'no'],
    ['SHA-256 fingerprint', sha256],
    ...(extensionsNode ? decodeExtensions(extensionsNode.children[0]) : []),
  ];
}

export async function inspectPem(text) {
  const sections = [];
  for (const { label, der } of parsePemBlocks(text)) {
    if (label === 'CERTIFICATE') {
      sections.push(`### Certificate\n\n${markdownTable(['Field', 'Value'], await inspectCertificate(der))}`);
    } else if (label === 'PUBLIC KEY') {
      sections.push(
        `### Public key\n\n${markdownTable(['Field', 'Value'], [['Algorithm', describeKey(readDer(der))]])}`,
      );
    } else if (label === 'CERTIFICATE REQUEST') {
      const info = readDer(der).children[0];
      sections.push(
        `### Certificate signing request\n\n${markdownTable(
          ['Field', 'Value'],
          [
            ['Subject', decodeName(info.children[1])],
            ['Public key', describeKey(info.children[2])],
          ],
        )}`,
      );
    } else if (/PRIVATE KEY/.test(label)) {
      sections.push(`### ${label}\n\n⚠️ This is a private key. Remove it from the document; it is not shown here.`);
    } else {
      sections.push(`### ${label}\n\n${der.length} bytes of DER data.`);
    }
  }
  return `> Inspection only: certificate chains and signatures are not verified.\n\n${sections.join('\n\n')}`;
}

const op = operationFactory('Developer', { outputMode: 'report' });

export const x509Operations = [
  op({
    id: 'pem.inspect',
    name: 'Inspect PEM / X.509 Certificate',
    description: 'Show subject, issuer, validity, key, SANs and fingerprint of PEM certificates, CSRs and public keys.',
    aliases: ['certificate', 'x509', 'ssl', 'tls', 'csr', 'pem'],
    notes: 'Does not verify certificate chains or signatures.',
    run: inspectPem,
  }),
];
