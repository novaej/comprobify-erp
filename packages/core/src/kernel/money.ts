import Decimal from 'decimal.js';
import { z } from 'zod';

// CLAUDE.md rule 14 and ADR-012: money and quantities are decimals, never floats. One
// configured copy, so every module rounds alike: half up, as an accountant would.
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof Dec>;
// A decimal, or a string or integer that becomes one.
export type DecValue = Decimal.Value;

// SRI's two rules (Ficha 9.17): amounts at most 2 decimals; quantity and unit price at most 6.
export const money = (value: DecValue): Dec => new Dec(value).toDecimalPlaces(2);
export const toSriAmount = (value: Dec): string => value.toFixed(2);
export const toSriPrecise = (value: Dec): string => value.toFixed(6);

// Input arrives as strings, so a float never stands in for a value. Zero is allowed here;
// each caller decides whether it may be.
export const amountInput = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const preciseInput = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
