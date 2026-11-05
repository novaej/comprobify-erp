// A RIDE is SRI's printed format, in Spanish only: these are its fixed texts and the
// Ficha's catalogue descriptions (Tablas 6 and 24), not UI strings.
export const RIDE_PAYMENT_METHODS: Record<string, string> = {
  '01': 'SIN UTILIZACIÓN DEL SISTEMA FINANCIERO',
  '15': 'COMPENSACIÓN DE DEUDAS',
  '16': 'TARJETA DE DÉBITO',
  '17': 'DINERO ELECTRÓNICO',
  '18': 'TARJETA PREPAGO',
  '19': 'TARJETA DE CRÉDITO',
  '20': 'OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO',
  '21': 'ENDOSO DE TÍTULOS',
};

export const RIDE_TERM_UNITS: Record<string, string> = { dias: 'DÍAS', meses: 'MESES' };

export const RIDE_DOCUMENT_TITLES: Record<string, string> = {
  '01': 'FACTURA',
  '04': 'NOTA DE CRÉDITO',
  '06': 'GUÍA DE REMISIÓN',
};

export const rideAmbiente = (ambiente: string) => (ambiente === '2' ? 'PRODUCCIÓN' : 'PRUEBAS');
export const rideEmission = (type: string) =>
  type === '2' ? 'INDISPONIBILIDAD DEL SISTEMA' : 'NORMAL';
