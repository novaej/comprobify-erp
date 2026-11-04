import { randomInt } from 'node:crypto';

// SRI rule 7 (Ficha 5.2): ddmmyyyy + type (2) + RUC (13) + ambiente (1) + series (6) +
// sequential (9) + numeric code (8) + emission type 1 + the Module 11 check digit.

// Weights 2 to 7 from the right, repeating; 11 becomes 0 and 10 becomes 1.
export function module11(digits: string): number {
  let sum = 0;
  let factor = 2;
  for (let index = digits.length - 1; index >= 0; index--) {
    sum += Number(digits[index]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const result = 11 - (sum % 11);
  return result === 11 ? 0 : result === 10 ? 1 : result;
}

// Chosen freely by the issuer as a security code; random, so a key can't be guessed.
export const randomNumericCode = (): string => String(randomInt(0, 100_000_000)).padStart(8, '0');

export type AccessKeyParts = {
  // YYYY-MM-DD, the Ecuador date of transmission (SRI rule 6).
  issueDate: string;
  documentType: string;
  ruc: string;
  ambiente: '1' | '2';
  series: string;
  sequential: number;
  numericCode: string;
};

export function accessKey(parts: AccessKeyParts): string {
  const [year, month, day] = parts.issueDate.split('-');
  const body = [
    `${day}${month}${year}`,
    parts.documentType,
    parts.ruc,
    parts.ambiente,
    parts.series,
    String(parts.sequential).padStart(9, '0'),
    parts.numericCode,
    '1',
  ].join('');
  // Every field at its full length, or SRI rejects the key (Ficha 5.2, note).
  if (!/^[0-9]{48}$/.test(body)) throw new Error('An access key part has the wrong length');
  return `${body}${module11(body)}`;
}
