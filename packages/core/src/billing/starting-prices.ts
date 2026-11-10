// ADR-027: placeholders, so every plan, add-on, seat and pack has a price from the first run.
// The super admin replaces them with the real ones in the platform area (Precios); these are
// only ever inserted for something that has no price at all, never over one.
// Monthly amounts before IVA, in dollars; a pack's is what it costs once.
export const STARTING_PRICES = {
  plans: { FREE: '0.00', STARTER: '9.90', BUSINESS: '29.90', ENTERPRISE: '79.90' },
  modules: {
    CREDIT_NOTES: '5.00',
    DELIVERY_GUIDES: '5.00',
    BRANDING: '3.00',
    INVENTORY: '15.00',
    PURCHASING: '10.00',
    SALES: '10.00',
    BULK_INVOICING: '15.00',
    ADVANCED_REPORTS: '10.00',
  },
  seat: '4.00',
  packs: { 100: '5.00', 500: '20.00', 2000: '60.00' },
} as const;

// The date the placeholders apply from: before any company could have been charged.
export const STARTING_PRICES_FROM = '2026-01-01';
