import { cn } from '@comprobify/ui/lib/utils';
import { Check, Clock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

// SRI's comprobante codes in the order it lists them; `ready` follows the starting catalogue
// (retenciones are a COMING_SOON module until Milestone 11+).
const DOCUMENT_TYPES = [
  { code: '01', ready: true },
  { code: '04', ready: true },
  { code: '06', ready: true },
  { code: '07', ready: false },
  { code: '03', ready: false },
] as const;

export async function LandingDocTypes() {
  const t = await getTranslations('landing.docTypes');

  return (
    <div>
      <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{t('title')}</h2>
      <p className="mt-3 max-w-xl text-muted-foreground">{t('subtitle')}</p>
      <ul className="mt-8 flex flex-wrap gap-2.5">
        {DOCUMENT_TYPES.map(({ code, ready }) => (
          <li key={code}>
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm',
                ready
                  ? 'border-primary/30 bg-card font-medium text-foreground shadow-sm'
                  : 'border-dashed border-border text-muted-foreground',
              )}
            >
              {ready ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              ) : (
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {t(`names.${code}`)}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-foreground">
                {code}
              </span>
              {!ready && <span className="sr-only">{t('soon')}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">{t('upcomingNote')}</p>
    </div>
  );
}
