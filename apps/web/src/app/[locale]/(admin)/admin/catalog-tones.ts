import type { Tone } from '@/components/tone-badge';

// Plain module, not the client one: server pages read it too, and a 'use client'
// file's constants reach them only as client references.
export const STATUS_TONE: Record<string, Tone> = {
  PUBLISHED: 'success',
  AVAILABLE: 'success',
  DRAFT: 'neutral',
  COMING_SOON: 'neutral',
  RETIRED: 'warning',
};
