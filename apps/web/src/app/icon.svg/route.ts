import { getRuntime } from '@/server/runtime';

// The logomark on a chip: teal in production, blue everywhere else, so a tab shows which
// deployment it is. Read at request time: one image serves every environment.
export const dynamic = 'force-dynamic';

const CHIPS = {
  production: {
    label: 'Comprobify',
    bg: '#0F766E',
    arc: '#F7F4EE',
    bolt: '#2DD4BF',
    stroke: '#0B1220',
  },
  other: {
    label: 'Comprobify (pruebas)',
    bg: '#2563EB',
    arc: '#EAF1FF',
    bolt: '#EAF1FF',
    stroke: '#1E3A8A',
  },
};

export async function GET() {
  const { env } = await getRuntime();
  const chip = env.APP_ENV === 'production' ? CHIPS.production : CHIPS.other;
  // The mark sits ~4px off centre in its artwork: invisible on transparency, plain on a chip.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${chip.label}">
  <title>${chip.label}</title>
  <rect x="4" y="4" width="112" height="112" rx="26" fill="${chip.bg}"></rect>
  <g transform="translate(-4,-4)">
    <path d="M 88 34 A 28 28 0 1 0 88 86" stroke="${chip.arc}" stroke-width="14" fill="none" stroke-linecap="round"></path>
    <path d="M 102 32 L 60 60 L 74 60 L 54 96 L 78 66 L 64 66 Z" fill="${chip.bolt}" stroke="${chip.stroke}" stroke-width="5" stroke-linejoin="round" style="paint-order: stroke fill"></path>
  </g>
</svg>`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
  });
}
