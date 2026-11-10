import { confirmCardPayment, isDomainError } from '@comprobify/core';
import { buttonVariants } from '@comprobify/ui/components/button';
import { cn } from '@comprobify/ui/lib/utils';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getRuntime } from '@/server/runtime';
import { loadShell } from '@/server/shell';
import { pageTitle } from '@/server/page-title';

export const generateMetadata = pageTitle('cardReturn');

// FR-BILL-3 (ADR-033): Payphone sends the payer here, to the address registered in its console.
// The confirm runs as the page renders, never behind a click: Payphone reverses a charge not
// confirmed within 5 minutes. Loading it again reads the stored answer without asking Payphone.
export default async function CardReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ id?: string; clientTransactionId?: string }>;
}) {
  const { locale } = await params;
  const { id, clientTransactionId } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('plan.cardReturn');
  const tError = await getTranslations('planError');

  if (!id || !clientTransactionId)
    return (
      <Outcome icon={HelpCircle} tone="muted" title={t('missingTitle')} body={t('missingBody')}>
        <BackToPlan locale={locale} label={t('back')} />
      </Outcome>
    );

  const { actor } = await loadShell(locale);
  const { db, payphoneDeps, logger, notice } = await getRuntime();
  let status: string;
  try {
    ({ status } = await confirmCardPayment(
      actor,
      db,
      { id, clientTransactionId },
      payphoneDeps,
      logger,
      notice,
    ));
  } catch (error) {
    const code = isDomainError(error)
      ? error.code
      : error instanceof Error && error.name === 'ZodError'
        ? 'NOT_FOUND'
        : null;
    if (!code) throw error;
    return (
      <Outcome
        icon={XCircle}
        tone="danger"
        title={t('errorTitle')}
        body={tError.has(code) ? tError(code) : tError('UNKNOWN')}
      >
        <BackToPlan locale={locale} label={t('back')} />
      </Outcome>
    );
  }

  switch (status) {
    case 'APPROVED':
      return (
        <Outcome
          icon={CheckCircle2}
          tone="success"
          title={t('approvedTitle')}
          body={t('approvedBody')}
        >
          <BackToPlan locale={locale} label={t('back')} primary />
        </Outcome>
      );
    case 'PENDING':
      // Unknown, not declined: never invite a second charge.
      return (
        <Outcome icon={Clock} tone="warning" title={t('pendingTitle')} body={t('pendingBody')} />
      );
    case 'CANCELLED':
    case 'EXPIRED':
      return (
        <Outcome icon={XCircle} tone="muted" title={t('cancelledTitle')} body={t('cancelledBody')}>
          <BackToPlan locale={locale} label={t('back')} primary />
        </Outcome>
      );
    case 'DUPLICATE':
      return (
        <Outcome
          icon={AlertTriangle}
          tone="warning"
          title={t('duplicateTitle')}
          body={t('duplicateBody')}
        >
          <BackToPlan locale={locale} label={t('back')} />
        </Outcome>
      );
    default:
      return (
        <Outcome icon={XCircle} tone="danger" title={t('errorTitle')} body={t('mismatchBody')}>
          <BackToPlan locale={locale} label={t('back')} />
        </Outcome>
      );
  }
}

const TONES = {
  success: 'bg-success-soft text-success',
  danger: 'bg-destructive/10 text-destructive',
  warning: 'bg-warning-soft text-warning',
  muted: 'bg-muted text-muted-foreground',
} as const;

function Outcome({
  icon: Icon,
  tone,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONES;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md py-10">
      <div
        role="status"
        className="rounded-xl border border-border bg-card p-8 text-center shadow-sm"
      >
        <div
          className={cn(
            'mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full',
            TONES[tone],
          )}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}

// A full load, not a client navigation: the plan page must read what the payment changed.
function BackToPlan({
  locale,
  label,
  primary,
}: {
  locale: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <a
      href={`/${locale}/plan`}
      className={buttonVariants({ variant: primary ? 'default' : 'outline' })}
    >
      {label}
    </a>
  );
}
