import 'server-only';
import { publicPricing, systemClock, type PublicPricing } from '@comprobify/core';
import { getRuntime } from './runtime';

// The pricing page is public, so a crawler or a burst of visitors must not each cost queries.
// A price edited in the platform area shows within this long.
const TTL_MS = 30_000;

// On globalThis, like the runtime: Next bundles routes separately.
const holder = globalThis as {
  comprobifyPublicPricing?: { at: number; value: Promise<PublicPricing> };
};

export async function loadPublicPricing(): Promise<PublicPricing> {
  const cached = holder.comprobifyPublicPricing;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const { db } = await getRuntime();
  const value = publicPricing(db, systemClock.now());
  holder.comprobifyPublicPricing = { at: Date.now(), value };
  // A failed read must not stick for the whole window.
  value.catch(() => {
    if (holder.comprobifyPublicPricing?.value === value) holder.comprobifyPublicPricing = undefined;
  });
  return value;
}
