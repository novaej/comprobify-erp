// Local development only: a P12 for a RUC, to try onboarding without a real signature.
// Usage: pnpm test-certificate <ruc> [days]   (password: secret)
// `days` makes it expire that many days from now, to try the expiry notices; it is valid for
// years otherwise.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestP12, testRuc } from '@comprobify/core/testing';

const ruc = process.argv[2] ?? testRuc();
if (!/^[0-9]{13}$/.test(ruc)) throw new Error('The RUC must be 13 digits');
// eslint-disable-next-line no-restricted-properties -- pnpm's original directory, for a dev script
const file = resolve(process.env.INIT_CWD ?? '.', `test-${ruc}.p12`);
const days = process.argv[3] === undefined ? null : Number(process.argv[3]);
if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650))
  throw new Error('Days must be a whole number from 1 to 3650');
const now = Date.now();
writeFileSync(
  file,
  createTestP12({
    ruc,
    commonName: 'PRUEBA LOCAL',
    ...(days === null
      ? {}
      : { notBefore: new Date(now - 86_400_000), notAfter: new Date(now + days * 86_400_000) }),
  }),
);
console.log(
  `Wrote ${file} for RUC ${ruc}${days === null ? '' : `, expiring in ${days} days`}. Password: secret`,
);
