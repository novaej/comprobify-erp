// SRI catalogues from the Ficha Técnica v2.32 (ADR-012). Code, not tables: they change only
// with a new Ficha, which needs a release anyway, and CHECKs are generated from them
// (CLAUDE.md rule 17). Labels live in the message files.

// Tabla 3.
export const SRI_DOCUMENT_TYPES = ['01', '03', '04', '05', '06', '07'] as const;

// Tabla 6. 07 is consumidor final, always 13 nines.
export const SRI_ID_TYPES = ['04', '05', '06', '07', '08'] as const;
export const CONSUMER_FINAL_ID = '9999999999999';

// Tabla 16.
export const SRI_TAX_CODES = ['2', '3', '5'] as const;

// Tabla 17: IVA. `selectable` rates are the ones a product can carry today; the others
// stay so that older documents still read, and need the accountant's word to be offered.
export const SRI_IVA_RATES = [
  { code: '0', percent: '0', selectable: true },
  { code: '2', percent: '12', selectable: false },
  { code: '3', percent: '14', selectable: false },
  { code: '4', percent: '15', selectable: true },
  { code: '5', percent: '5', selectable: true },
  { code: '6', percent: '0', selectable: true },
  { code: '7', percent: '0', selectable: true },
  { code: '8', percent: '0', selectable: false },
  { code: '10', percent: '13', selectable: false },
] as const;
export const SRI_IVA_RATE_CODES = SRI_IVA_RATES.map((rate) => rate.code);

// Tabla 24.
export const SRI_PAYMENT_METHODS = ['01', '15', '16', '17', '18', '19', '20', '21'] as const;

// unidadTiempo in pagos.
export const SRI_TERM_UNITS = ['dias', 'meses'] as const;
