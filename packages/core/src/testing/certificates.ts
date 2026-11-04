import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

// Security Data's RUC extension: a real CA's layout, for tests only.
const RUC_OID = '1.3.6.1.4.1.37746.3.11';

export type TestP12Options = {
  ruc?: string;
  password?: string;
  notBefore?: Date;
  notAfter?: Date;
  commonName?: string;
  // Hex, as X.509 stores it; real CAs use 16 bytes or more.
  serialNumber?: string;
};

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey: forge.pki.privateKeyFromPem(
      privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    ),
    publicKey: forge.pki.publicKeyFromPem(
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    ),
  };
}

// A P12 shaped like an SRI-accredited one: a signing certificate carrying the
// RUC, its CA certificate, and the key. Built with node's fast key generation.
export function createTestP12(options: TestP12Options = {}): Buffer {
  const now = Date.now();
  const ca = keyPair();
  const leaf = keyPair();
  const caName = [
    { shortName: 'O', value: 'TEST CA S.A.' },
    { shortName: 'CN', value: 'Test CA' },
  ];

  const caCert = forge.pki.createCertificate();
  caCert.publicKey = ca.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date(now - 365 * 86_400_000);
  caCert.validity.notAfter = new Date(now + 10 * 365 * 86_400_000);
  caCert.setSubject(caName);
  caCert.setIssuer(caName);
  caCert.sign(ca.privateKey, forge.md.sha256.create());

  const cert = forge.pki.createCertificate();
  cert.publicKey = leaf.publicKey;
  cert.serialNumber = options.serialNumber ?? '02';
  cert.validity.notBefore = options.notBefore ?? new Date(now - 86_400_000);
  cert.validity.notAfter = options.notAfter ?? new Date(now + 365 * 86_400_000);
  cert.setSubject([{ shortName: 'CN', value: options.commonName ?? 'ANA PEREZ' }]);
  cert.setIssuer(caName);
  const extensions: object[] = [{ name: 'basicConstraints', cA: false }];
  if (options.ruc) {
    const value = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.UTF8,
      false,
      options.ruc,
    );
    extensions.push({ id: RUC_OID, value: forge.asn1.toDer(value).getBytes() });
  }
  cert.setExtensions(extensions);
  cert.sign(ca.privateKey, forge.md.sha256.create());

  const asn1 = forge.pkcs12.toPkcs12Asn1(
    leaf.privateKey,
    [cert, caCert],
    options.password ?? 'secret',
    {
      algorithm: '3des',
    },
  );
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

// A RUC with valid structure for a person: province 17, third digit 1, establishment 001.
export function testRuc(): string {
  return `171${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}001`;
}
