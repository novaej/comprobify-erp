import { describe, expect, it } from 'vitest';
import { ecuadorDate } from '../kernel';
import { accessKey, module11, randomNumericCode } from './access-key';

// SRI rule 7, against the Ficha Técnica v2.32's own examples.
describe('access key', () => {
  it('computes Module 11 as the Ficha’s worked example does', () => {
    expect(module11('41261533')).toBe(6);
  });

  it('gives the check digit of every example key in the Ficha', () => {
    for (const key of [
      '1702201205176001321000110010030001000011234567816',
      '0503201201176001321000110010030009900641234567814',
      '1302201201176001321000120010030000050431234567814',
      '2808201400179210439400110010010000000091234567812',
    ])
      expect(module11(key.slice(0, 48))).toBe(Number(key[48]));
  });

  it('builds a key from its parts, the date in ddmmyyyy', () => {
    const key = accessKey({
      issueDate: '2012-02-17',
      documentType: '05',
      ruc: '1760013210001',
      ambiente: '1',
      series: '001003',
      sequential: 100001,
      numericCode: '12345678',
    });
    expect(key).toBe('1702201205176001321000110010030001000011234567816');
  });

  it('refuses a part of the wrong length', () => {
    expect(() =>
      accessKey({
        issueDate: '2026-11-10',
        documentType: '01',
        ruc: '176001321000',
        ambiente: '1',
        series: '001001',
        sequential: 1,
        numericCode: '12345678',
      }),
    ).toThrow();
  });

  it('draws an 8-digit numeric code', () => {
    for (let i = 0; i < 20; i++) expect(randomNumericCode()).toMatch(/^[0-9]{8}$/);
  });

  // Rule 15: the issue date is the Ecuador day, not UTC's.
  it('takes the issue date in Ecuador time', () => {
    expect(ecuadorDate(new Date('2026-11-11T04:59:59Z'))).toBe('2026-11-10');
    expect(ecuadorDate(new Date('2026-11-11T05:00:00Z'))).toBe('2026-11-11');
  });
});
