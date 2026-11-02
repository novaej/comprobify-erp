import type { Database } from '@comprobify/db';
import { z } from 'zod';
import { certificateMatchesRuc, parseP12, type KeyCipher } from '../certificates';
import { DomainError, type Clock } from '../kernel';
import { sniffLogo } from './logo';
import {
  createOrganization,
  createOrganizationInput,
  type CreatedOrganization,
} from './organizations';
import { isValidRucStructure } from './ruc';

// Any Uint8Array, Node's Buffer included.
const bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'Expected bytes');

export const onboardOrganizationInput = createOrganizationInput.extend({
  certificate: z.object({
    file: bytes,
    password: z.string().max(256),
  }),
  logo: bytes.nullable(),
});

// FR-ONB-2 to FR-ONB-4. Everything is checked before anything is written, so a
// bad certificate or logo leaves no half-created organization.
export async function onboardOrganization(
  db: Database,
  raw: z.input<typeof onboardOrganizationInput>,
  deps: { keyCipher: KeyCipher; clock: Clock },
): Promise<CreatedOrganization> {
  const { certificate, logo, ...organization } = onboardOrganizationInput.parse(raw);
  if (!isValidRucStructure(organization.ruc))
    throw new DomainError('INVALID_RUC', 'Not a valid RUC');

  const parsed = parseP12(certificate.file, certificate.password, deps.clock.now());
  if (!certificateMatchesRuc(parsed.identifiers, organization.ruc)) {
    throw new DomainError(
      'CERTIFICATE_RUC_MISMATCH',
      'The certificate does not belong to this RUC',
    );
  }

  return createOrganization(db, organization, {
    certificate: {
      encryptedPrivateKey: deps.keyCipher.encrypt(parsed.privateKeyPem),
      certificatePem: parsed.certificatePem,
      fingerprint: parsed.fingerprint,
      subjectName: parsed.subjectName,
      issuerName: parsed.issuerName,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
    },
    logo: logo ? sniffLogo(Buffer.from(logo)) : undefined,
  });
}
