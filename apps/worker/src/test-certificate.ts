// Local development only: a P12 for a RUC, to try onboarding without a real signature.
// Usage: pnpm test-certificate <ruc>   (password: secret)
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestP12, testRuc } from '@comprobify/core/testing';

const ruc = process.argv[2] ?? testRuc();
if (!/^[0-9]{13}$/.test(ruc)) throw new Error('The RUC must be 13 digits');
// eslint-disable-next-line no-restricted-properties -- pnpm's original directory, for a dev script
const file = resolve(process.env.INIT_CWD ?? '.', `test-${ruc}.p12`);
writeFileSync(file, createTestP12({ ruc, commonName: 'PRUEBA LOCAL' }));
console.log(`Wrote ${file} for RUC ${ruc}. Password: secret`);
