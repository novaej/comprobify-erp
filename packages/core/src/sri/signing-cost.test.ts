import { cpus } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseP12 } from '../certificates';
import { createTestP12, sampleFactura } from '../testing';
import { buildFactura } from './factura';
import { signXml } from './signer';
import { validateXml } from './xsd';

// NFR-PERF-2: what one invoice costs us before SRI, measured on demand (`pnpm bench:signing`),
// not in every run. The figures go in ADR-013.
// eslint-disable-next-line no-restricted-properties -- a switch for this one test, not app config
describe.runIf(process.env.SIGNING_BENCH === '1')('the cost of signing an invoice', () => {
  it('builds, validates and signs invoices of 1, 20 and 200 lines', async () => {
    const now = new Date('2026-11-10T15:00:00Z');
    const key = parseP12(
      createTestP12({ notBefore: new Date('2026-01-01'), notAfter: new Date('2027-12-31') }),
      'secret',
      now,
    );
    const base = sampleFactura();
    const line = base.lines[0]!;
    const rounds = 200;
    const report: Record<string, string> = { cpu: cpus()[0]?.model ?? 'unknown' };
    for (const size of [1, 20, 200]) {
      const input = { ...base, lines: Array.from({ length: size }, () => line) };
      // Warm-up: the XSD is compiled on first use.
      await validateXml(signXml(buildFactura(input).xml, key, now), '01');
      const time = { build: 0, validate: 0, sign: 0 };
      for (let i = 0; i < rounds; i++) {
        let t = performance.now();
        const { xml } = buildFactura(input);
        time.build += performance.now() - t;
        t = performance.now();
        expect((await validateXml(xml, '01')).valid).toBe(true);
        time.validate += performance.now() - t;
        t = performance.now();
        signXml(xml, key, now);
        time.sign += performance.now() - t;
      }
      const ms = (value: number) => (value / rounds).toFixed(2);
      report[`${size} lines`] =
        `build ${ms(time.build)} ms, XSD ${ms(time.validate)} ms, sign ${ms(time.sign)} ms`;
    }
    console.log(JSON.stringify(report, null, 2));
  }, 120_000);
});
