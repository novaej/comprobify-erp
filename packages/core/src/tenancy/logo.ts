import { DomainError } from '../kernel';

export const LOGO_MAX_BYTES = 500 * 1024;

export type Logo = { content: Buffer; contentType: 'image/png' | 'image/jpeg' | 'image/gif' };

// By content, not by the file name or the browser's claim (PRD 9.3).
export function sniffLogo(content: Buffer): Logo {
  if (content.length === 0 || content.length > LOGO_MAX_BYTES) {
    throw new DomainError('INVALID_LOGO', 'The logo must be at most 500 KB');
  }
  const starts = (bytes: number[]) => bytes.every((byte, index) => content[index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { content, contentType: 'image/png' };
  if (starts([0xff, 0xd8, 0xff])) return { content, contentType: 'image/jpeg' };
  const head = content.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return { content, contentType: 'image/gif' };
  throw new DomainError('INVALID_LOGO', 'The logo must be a PNG, JPEG or GIF image');
}
