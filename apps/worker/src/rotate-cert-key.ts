// Operator only (ADR-052): re-encrypt every stored certificate key under CERT_ENCRYPTION_KEY, reading
// the ones still under CERT_ENCRYPTION_KEY_PREVIOUS. A dry run unless --commit; a second run finds
// nothing to do. docs/guides/certificate-key-rotation.md is the procedure.
// Usage: pnpm rotate:cert-key [--commit]
import { parseArgs } from 'node:util';
import { loadCertKeyRotationEnv } from '@comprobify/config/env';
import { createLogger } from '@comprobify/config/logger';
import { createKeyCipher, rotateCertificateKeys } from '@comprobify/core';
import { createDatabase } from '@comprobify/db';

const { values } = parseArgs({ options: { commit: { type: 'boolean', default: false } } });
const env = loadCertKeyRotationEnv();
const logger = createLogger({ service: 'rotate-cert-key', level: 'warn' });
const keyCipher = createKeyCipher(env.CERT_ENCRYPTION_KEY, env.CERT_ENCRYPTION_KEY_PREVIOUS);
const db = createDatabase({ connectionString: env.DATABASE_URL, logger, maxConnections: 1 });

try {
  await db.assertSafeConnection();
  const report = await rotateCertificateKeys(db, keyCipher, { commit: values.commit });
  console.log(`Current key: ${keyCipher.currentKeyId}`);
  console.log(`Stored certificate keys: ${report.total}`);
  for (const [id, count] of Object.entries(report.byKey))
    console.log(
      `  ${id === keyCipher.currentKeyId ? `${id} (current)` : id === 'v1' ? 'v1 (before key ids)' : id}: ${count}`,
    );
  if (report.reencrypted === 0)
    console.log('Nothing to re-encrypt: every key is under the current one.');
  else if (values.commit)
    console.log(`Re-encrypted ${report.reencrypted} under ${keyCipher.currentKeyId}.`);
  else
    console.log(
      `Dry run: ${report.reencrypted} would be re-encrypted, and every one of them opened. Add --commit.`,
    );
} catch (error) {
  console.error(`Nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
