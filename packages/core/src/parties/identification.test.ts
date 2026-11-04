import { describe, expect, it } from 'vitest';
import { isValidCedula, isValidIdentification } from './identification';

// FR-MD-2: cédulas by their check digit, RUCs by structure (as onboarding), others by shape.
describe('identification', () => {
  it('accepts a cédula whose Module 10 check digit matches', () => {
    expect(isValidCedula('1710034065')).toBe(true);
    expect(isValidCedula('1710034066')).toBe(false);
    // Province 25 doesn't exist; third digit 6 isn't a person.
    expect(isValidCedula('2510034065')).toBe(false);
    expect(isValidCedula('1760034065')).toBe(false);
  });

  it('checks each type by its own rule, and never takes consumidor final', () => {
    expect(isValidIdentification('05', '1710034065')).toBe(true);
    expect(isValidIdentification('04', '1790012345001')).toBe(true);
    expect(isValidIdentification('04', '1790012345000')).toBe(false);
    expect(isValidIdentification('06', 'AB123456')).toBe(true);
    expect(isValidIdentification('06', 'AB 123')).toBe(false);
    expect(isValidIdentification('04', '9999999999999')).toBe(false);
    expect(isValidIdentification('07', '9999999999999')).toBe(false);
  });
});
