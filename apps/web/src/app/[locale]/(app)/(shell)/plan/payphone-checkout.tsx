'use client';

import type { CardSession } from '@comprobify/core';
import { Loader2 } from 'lucide-react';
import Script from 'next/script';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

// Payphone's Cajita de Pagos v2.0 (ADR-033). The return address is the one registered in
// Payphone's console, not part of this configuration. Mount it with the session's id as its key:
// the widget attaches once, so a new attempt needs a new instance.
const CSS_URL = 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.css';
const JS_URL = 'https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.js';
const CONTAINER_ID = 'pp-button';

type WidgetConfig = Omit<CardSession, 'attemptId'> & { lang: 'es' | 'en' };

declare global {
  interface Window {
    PPaymentButtonBox?: new (config: WidgetConfig) => { render(containerId: string): void };
  }
}

export function PayphoneCheckout({ session }: { session: CardSession }) {
  const locale = useLocale();
  const t = useTranslations('plan.card');
  const [ready, setReady] = useState(false);
  const rendered = useRef(false);

  useEffect(() => {
    if (!ready || rendered.current || !window.PPaymentButtonBox) return;
    rendered.current = true;
    new window.PPaymentButtonBox({
      token: session.token,
      clientTransactionId: session.clientTransactionId,
      amount: session.amount,
      amountWithoutTax: session.amountWithoutTax,
      amountWithTax: session.amountWithTax,
      tax: session.tax,
      service: session.service,
      tip: session.tip,
      currency: session.currency,
      storeId: session.storeId,
      reference: session.reference,
      lang: locale === 'en' ? 'en' : 'es',
    }).render(CONTAINER_ID);
  }, [ready, session, locale]);

  return (
    <div>
      <link rel="stylesheet" href={CSS_URL} />
      <Script src={JS_URL} strategy="afterInteractive" onReady={() => setReady(true)} />
      {!ready && (
        <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('loading')}
        </p>
      )}
      <div id={CONTAINER_ID} />
    </div>
  );
}
