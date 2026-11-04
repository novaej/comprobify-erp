import { CONSUMER_FINAL_ID } from '@comprobify/db';
import { isValidRucStructure } from '../tenancy';

// Cédula: province 01-24 or 30, third digit below 6, and the Module 10 check digit.
export function isValidCedula(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value)) return false;
  const province = Number(value.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30)) return false;
  if (Number(value[2]) >= 6) return false;
  const sum = [...value.slice(0, 9)].reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 2 : 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return (10 - (sum % 10)) % 10 === Number(value[9]);
}

// FR-MD-2 by identification type (Ficha Tabla 6). A RUC is checked by structure only,
// as onboarding does: newer RUCs don't always pass the old check-digit rule.
export function isValidIdentification(idType: string, value: string): boolean {
  if (value === CONSUMER_FINAL_ID) return false;
  switch (idType) {
    case '04':
      return isValidRucStructure(value);
    case '05':
      return isValidCedula(value);
    case '06':
    case '08':
      return /^[A-Za-z0-9-]{3,20}$/.test(value);
    default:
      return false;
  }
}
