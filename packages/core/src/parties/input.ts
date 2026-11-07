import { CLIENT_ID_TYPES, SRI_TERM_UNITS } from '@comprobify/db';
import { z } from 'zod';
import { isValidIdentification } from './identification';

// SRI's text fields refuse newlines; lengths are the factura XSD's.
export const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\n\r\t]*$/);

// A client's or a provider's identity and terms (FR-MD-2, FR-MD-3).
export const clientInput = z
  .object({
    idType: z.enum(CLIENT_ID_TYPES as [string, ...string[]]),
    identification: z.string().trim().toUpperCase().max(20),
    name: line(300),
    emails: z.array(z.email().max(254).toLowerCase()).max(5).default([]),
    phone: line(30).nullable().default(null),
    address: line(300).nullable().default(null),
    paymentTerm: z.number().int().min(1).max(3650).nullable().default(null),
    paymentTermUnit: z.enum(SRI_TERM_UNITS).nullable().default(null),
  })
  .refine((input) => isValidIdentification(input.idType, input.identification), {
    path: ['identification'],
    message: 'Invalid identification for its type',
  })
  .refine((input) => (input.paymentTerm === null) === (input.paymentTermUnit === null), {
    path: ['paymentTermUnit'],
    message: 'A payment term needs its unit',
  });
