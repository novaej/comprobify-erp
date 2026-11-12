import { getTranslations } from 'next-intl/server';
import { cn } from '@comprobify/ui/lib/utils';
import { HeroPlayOnView } from './hero-play-on-view';

// Fictional: 8 date + 2 type + 13 RUC + 1 env + 6 series + 9 sequential + 8 code + 1 emission + 1 check digit.
const SAMPLE_ACCESS_KEY = '1610202601179000000000110010010000001231234567814';
const SAMPLE_NUMBER = '001-001-000000123';

/** Barcode-like bars derived from the key's digits, so it's stable across renders. */
function Barcode({ value }: { value: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const ch of value) {
    const d = Number(ch);
    const w = 1 + (d % 3);
    bars.push({ x, w });
    x += w + 1 + ((d * 7) % 2);
  }
  return (
    <svg
      viewBox={`0 0 ${x} 20`}
      preserveAspectRatio="none"
      aria-hidden
      className="h-6 w-full text-foreground"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={20} fill="currentColor" />
      ))}
    </svg>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

/**
 * The landing hero's sample RIDE (the printed representation of an authorized
 * invoice), laid out like the real SRI document with fictional data. The status
 * line animates with pure CSS (see `.hero-status-early` in globals.css); the
 * rendered markup is the final, authorized state.
 */
export async function HeroDocument() {
  const t = await getTranslations('landing.hero.sample');
  const r = await getTranslations('landing.hero.sample.ride');

  const statusStack = 'col-start-1 row-start-1';
  const PILL = 'rounded-full border px-2 py-0.5 text-3xs font-semibold uppercase';

  return (
    <HeroPlayOnView className="relative mx-auto w-full max-w-[26rem]">
      <div
        role="group"
        aria-label={t('caption')}
        className="relative overflow-hidden rounded-lg border border-border bg-card text-3xs leading-snug text-card-foreground shadow-xl shadow-primary/10 dark:shadow-black/40"
      >
        {/* Issuer + document identity */}
        <div className="grid grid-cols-2 border-b border-border">
          <div className="space-y-2 border-r border-border p-3">
            <p className="text-2xs font-semibold">{r('issuer')}</p>
            <p>{r('issuerTrade')}</p>
            <p>
              <Label>{r('addressLabel')}</Label> {r('address')}
            </p>
            <p>
              {r('accounting')} <span className="font-semibold">{r('accountingValue')}</span>
            </p>
          </div>
          <div className="space-y-1.5 p-3">
            <p>
              <Label>{r('rucLabel')}</Label>{' '}
              <span className="font-semibold tabular-nums">{r('ruc')}</span>
            </p>
            <p className="text-xs font-bold">{r('invoice')}</p>
            <p>
              {r('numberLabel')} <span className="tabular-nums">{SAMPLE_NUMBER}</span>
            </p>
            <div>
              <Label>{r('accessKey')}</Label>
              <div className="mt-1">
                <Barcode value={SAMPLE_ACCESS_KEY} />
              </div>
              <p className="mt-0.5 font-mono text-3xs break-all tabular-nums">
                {SAMPLE_ACCESS_KEY}
              </p>
            </div>
            <div className="hero-late">
              <Label>{r('authDate')}</Label>
              <p className="tabular-nums">{r('authDateValue')}</p>
            </div>
            <p className="flex justify-between gap-2">
              <Label>{r('environment')}</Label> <span>{r('environmentValue')}</span>
            </p>
            <p className="flex justify-between gap-2">
              <Label>{r('emission')}</Label> <span>{r('emissionValue')}</span>
            </p>
            <p className="flex justify-between gap-2">
              <Label>{r('status')}</Label>
              <span className="grid justify-items-end">
                <span
                  className={cn(
                    statusStack,
                    'hero-status-early border-border bg-muted text-foreground',
                    PILL,
                  )}
                  style={{ '--hero-delay': '0.7s' } as React.CSSProperties}
                >
                  {r('statusSigned')}
                </span>
                <span
                  className={cn(
                    statusStack,
                    'hero-status-early border-info-border bg-info-soft text-info',
                    PILL,
                  )}
                  style={{ '--hero-delay': '2.3s' } as React.CSSProperties}
                >
                  {r('statusReceived')}
                </span>
                <span
                  className={cn(
                    statusStack,
                    'hero-late border-success-border bg-success-soft text-success',
                    PILL,
                  )}
                >
                  {r('statusAuthorized')}
                </span>
              </span>
            </p>
          </div>
        </div>

        {/* Buyer */}
        <div className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-b border-border p-3">
          <div>
            <Label>{r('buyerLabel')}</Label>
            <p className="font-medium">{r('buyer')}</p>
          </div>
          <div>
            <Label>{r('dateLabel')}</Label>
            <p className="tabular-nums">{r('date')}</p>
          </div>
          <div className="col-span-2">
            <Label>{r('idLabel')}</Label>
            <p className="tabular-nums">{r('id')}</p>
          </div>
        </div>

        {/* Line items */}
        <div className="border-b border-border">
          <div className="grid grid-cols-[2.25rem_1fr_4rem_3.5rem] gap-2 bg-muted/60 px-3 py-1.5 font-semibold">
            <span>{r('qty')}</span>
            <span>{r('description')}</span>
            <span className="text-right">{r('unitPrice')}</span>
            <span className="text-right">{r('lineTotal')}</span>
          </div>
          <div className="grid grid-cols-[2.25rem_1fr_4rem_3.5rem] gap-2 px-3 py-2 tabular-nums">
            <span>1.00</span>
            <span className="font-sans">{r('item')}</span>
            <span className="text-right">250.00</span>
            <span className="text-right">250.00</span>
          </div>
        </div>

        {/* Payment + totals */}
        <div className="grid grid-cols-2">
          <div className="relative border-r border-border p-3">
            <p className="font-semibold">{r('payment')}</p>
            <p className="mt-1 text-muted-foreground">{r('paymentValue')}</p>
            <p className="hero-stamp absolute bottom-3 left-3 -rotate-6 rounded-md border-2 border-success/70 bg-card px-2 py-1 text-3xs font-semibold text-success">
              {t('stamp')}
            </p>
          </div>
          <dl className="divide-y divide-border tabular-nums">
            <div className="flex justify-between gap-2 px-3 py-1.5">
              <dt>{r('subtotal')}</dt>
              <dd>250.00</dd>
            </div>
            <div className="flex justify-between gap-2 px-3 py-1.5">
              <dt>{r('vat')}</dt>
              <dd>37.50</dd>
            </div>
            <div className="flex justify-between gap-2 bg-muted/60 px-3 py-1.5 font-bold">
              <dt>{r('total')}</dt>
              <dd>287.50</dd>
            </div>
          </dl>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">
        {t('caption')}
      </figcaption>
    </HeroPlayOnView>
  );
}
