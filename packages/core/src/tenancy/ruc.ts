// Structure only, by the owner's decision: the certificate match is the proof of
// ownership, and check-digit rules would risk rejecting a real RUC.
// 13 digits; province 01 to 24, or 30 for foreigners; third digit 0 to 6 or 9;
// establishment number not 000.
export function isValidRucStructure(ruc: string): boolean {
  if (!/^[0-9]{13}$/.test(ruc)) return false;
  const province = Number(ruc.slice(0, 2));
  const type = Number(ruc[2]);
  const validProvince = (province >= 1 && province <= 24) || province === 30;
  const validType = type <= 6 || type === 9;
  return validProvince && validType && ruc.slice(10) !== '000';
}
