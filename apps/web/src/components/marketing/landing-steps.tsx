'use client';

import { cn } from '@comprobify/ui/lib/utils';
import { ArrowRight, Building2, Check, FileKey, FileText, UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { ctaVariants } from './cta-button';

const ICONS = [UserPlus, Building2, FileText] as const;
const STEPS = [1, 2, 3] as const;

// The three-step start. The rail fills as each step scrolls into view; the text never depends
// on it, so the section reads the same if the observer never runs.
export function LandingSteps() {
  const t = useTranslations('landing.steps');
  const locale = useLocale();
  // The step whose picture shows; the rail fills up to it.
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // Starts once the list is on screen: it walks through the steps, then stops. A click takes
  // over. Skipped with reduced motion, where the steps are chosen by hand.
  useEffect(() => {
    const node = listRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setPlaying(true);
        observer.disconnect();
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setActive((current) => {
        if (current >= STEPS.length - 1) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 2200);
    return () => clearInterval(timer);
  }, [playing]);

  const choose = (index: number) => {
    setPlaying(false);
    setActive(index);
  };
  const reached = active + 1;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14">
      <ol ref={listRef} className="relative space-y-8">
        <span aria-hidden className="absolute top-5 bottom-5 left-5 w-px bg-border">
          <span
            style={{ height: `${(reached / STEPS.length) * 100}%` }}
            className="block w-px bg-primary transition-[height] duration-700 ease-out motion-reduce:transition-none"
          />
        </span>
        {STEPS.map((n, index) => {
          const Icon = ICONS[index]!;
          return (
            <li key={n} className="relative flex gap-4">
              <button
                type="button"
                onClick={() => choose(index)}
                aria-label={t(`step${n}.title`)}
                aria-current={index === active ? 'step' : undefined}
                className={cn(
                  'relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors duration-500 motion-reduce:transition-none',
                  index < reached
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </button>
              <div className="pt-0.5">
                <span className="text-xs font-semibold text-primary">
                  {t('stepLabel', { number: n })}
                </span>
                <h3 className="mt-1 font-semibold">{t(`step${n}.title`)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(`step${n}.description`)}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-5">
        <div className="grid">
          {[<SignupMock key="1" />, <CompanyMock key="2" />, <InvoiceMock key="3" />].map(
            (panel, i) => (
              <div
                key={i}
                aria-hidden="true"
                className={cn(
                  'col-start-1 row-start-1 transition-opacity duration-500 motion-reduce:transition-none',
                  i === active ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                {panel}
              </div>
            ),
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <a href={`/${locale}/register`} className={ctaVariants()}>
            {t('cta')}
            <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
          </a>
          <p className="text-xs text-muted-foreground">{t('ctaNote')}</p>
        </div>
      </div>
    </div>
  );
}

function MockWindow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-destructive/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary/50" />
        <span className="ml-2 text-xs text-muted-foreground">{title}</span>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function MockButton({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 text-center text-sm font-medium',
        primary ? 'bg-primary text-primary-foreground' : 'border border-border',
      )}
    >
      {children}
    </div>
  );
}

function MockField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-2xs text-muted-foreground">{label}</span>
      <div
        className={cn(
          'mt-1 rounded-md border border-border px-3 py-2 text-sm',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SignupMock() {
  const t = useTranslations('landing.steps.mocks.signup');
  return (
    <MockWindow title={t('title')}>
      <MockField label={t('email')} value={t('emailValue')} />
      <MockField label={t('password')} value={t('passwordValue')} />
      <MockButton primary>{t('submit')}</MockButton>
    </MockWindow>
  );
}

function CompanyMock() {
  const t = useTranslations('landing.steps.mocks.company');
  return (
    <MockWindow title={t('title')}>
      <div className="grid grid-cols-2 gap-3">
        <MockField label={t('ruc')} value={t('rucValue')} mono />
        <MockField label={t('branch')} value={t('branchValue')} mono />
      </div>
      <MockField label={t('name')} value={t('nameValue')} />
      <div className="flex items-center gap-3 rounded-md border border-success-border bg-success-soft px-3 py-2.5 text-success">
        <FileKey className="h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 text-sm">
          <p className="truncate font-mono text-xs">{t('certFile')}</p>
          <p className="text-xs">{t('certValid')}</p>
        </div>
        <Check className="ml-auto h-4 w-4 shrink-0" aria-hidden />
      </div>
    </MockWindow>
  );
}

function InvoiceMock() {
  const t = useTranslations('landing.steps.mocks.invoice');
  return (
    <MockWindow title={t('title')}>
      <MockField label={t('buyer')} value={t('buyerValue')} />
      <MockField label={t('item')} value={t('itemValue')} />
      <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2">
        <span className="text-xs text-muted-foreground">{t('total')}</span>
        <span className="font-mono text-sm font-semibold">$112.00</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MockButton>{t('sign')}</MockButton>
        <MockButton primary>{t('signSend')}</MockButton>
      </div>
    </MockWindow>
  );
}
