'use client';

import type { GuideContent as CoreGuideContent } from '@comprobify/core';
import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { AlertCircle, Plus, Send, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Banner } from '@/components/banner';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormActionBar } from '@/components/form-action-bar';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { normalizeDecimal, parseDecimal } from '@/lib/invoice-totals';
import { correctGuideAction, createGuideAction } from './actions';

export type GuideContent = CoreGuideContent;
type GuideRecipient = GuideContent['recipients'][number];
type GuideLine = GuideRecipient['lines'][number];

const blankLine = (): GuideLine => ({
  code: null,
  auxiliaryCode: null,
  name: '',
  quantity: '1',
  additionalDetails: [],
});
const blankRecipient = (): GuideRecipient => ({
  identification: '',
  name: '',
  address: '',
  reason: 'Venta',
  customsDocument: null,
  destinationEstablishment: null,
  route: null,
  support: null,
  lines: [blankLine()],
});

// The guía de remisión form: where it leaves from, who carries it, and what goes to whom.
export function GuideForm({
  issuePoints,
  carrierTypes,
  today,
  originId,
  originNumber,
  initial,
  draft,
}: {
  issuePoints: Choice[];
  carrierTypes: Choice[];
  // YYYY-MM-DD.
  today: string;
  originId: string | null;
  originNumber: string | null;
  initial?: Partial<GuideContent>;
  draft?: { documentId: string };
}) {
  const t = useTranslations('guideForm');
  const tError = useTranslations('documentsError');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [issuePointId, setIssuePointId] = useState(issuePoints[0]?.value ?? '');
  const [departure, setDeparture] = useState(initial?.departureAddress ?? '');
  const [carrier, setCarrier] = useState<GuideContent['carrier']>(
    initial?.carrier ?? {
      idType: (carrierTypes[0]?.value ?? '04') as GuideContent['carrier']['idType'],
      identification: '',
      name: '',
      rise: null,
    },
  );
  const [plate, setPlate] = useState(initial?.plate ?? '');
  const [start, setStart] = useState(initial?.transportStart ?? today);
  const [end, setEnd] = useState(initial?.transportEnd ?? today);
  const [recipients, setRecipients] = useState<GuideRecipient[]>(
    initial?.recipients?.length ? initial.recipients : [blankRecipient()],
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const changeRecipient = (index: number, change: Partial<GuideRecipient>) =>
    setRecipients((current) =>
      current.map((one, i) => (i === index ? { ...one, ...change } : one)),
    );
  const changeLine = (index: number, lineIndex: number, change: Partial<GuideLine>) =>
    changeRecipient(index, {
      lines: recipients[index]!.lines.map((line, i) =>
        i === lineIndex ? { ...line, ...change } : line,
      ),
    });

  const filled = (value: string) => value.trim() !== '';
  const goodsOk = (line: GuideLine) =>
    filled(line.name) && (parseDecimal(line.quantity) ?? 0n) > 0n;
  const datesOk = start >= today && end >= start;
  const canSend =
    issuePointId !== '' &&
    filled(departure) &&
    filled(carrier.identification) &&
    filled(carrier.name) &&
    filled(plate) &&
    datesOk &&
    recipients.every(
      (one) =>
        filled(one.identification) &&
        filled(one.name) &&
        filled(one.address) &&
        filled(one.reason) &&
        one.lines.length > 0 &&
        one.lines.every(goodsOk),
    );

  const send = () => {
    const form = new FormData();
    form.set('locale', locale);
    const clean = (value: string | null) => (value && value.trim() ? value.trim() : null);
    const content = {
      departureAddress: departure.trim(),
      carrier: {
        idType: carrier.idType,
        identification: carrier.identification.trim(),
        name: carrier.name.trim(),
        rise: clean(carrier.rise),
      },
      transportStart: start,
      transportEnd: end,
      plate: plate.trim(),
      recipients: recipients.map((one) => ({
        ...one,
        identification: one.identification.trim(),
        name: one.name.trim(),
        address: one.address.trim(),
        reason: one.reason.trim(),
        route: clean(one.route),
        support: one.support
          ? { ...one.support, authorization: clean(one.support.authorization) }
          : null,
        lines: one.lines.map((line) => ({
          ...line,
          code: clean(line.code),
          name: line.name.trim(),
          quantity: normalizeDecimal(line.quantity),
        })),
      })),
      additionalInfo: initial?.additionalInfo ?? [],
    };
    form.set(
      'payload',
      JSON.stringify(
        draft ? content : { ...content, issuePointId, originId, idempotencyKey: null },
      ),
    );
    if (draft) form.set('id', draft.documentId);
    startTransition(async () => {
      // Success redirects to the guía; only a refusal comes back.
      const state = await (draft ? correctGuideAction : createGuideAction)({}, form);
      if (state?.error) setError(tError.has(state.error) ? tError(state.error) : tError('UNKNOWN'));
    });
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(undefined);
        if (canSend) setConfirming(true);
      }}
      className="space-y-6"
    >
      <SectionCard title={t('issuing.title')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('issuing.issuePoint')} required>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={issuePointId}
                onChange={setIssuePointId}
                options={issuePoints}
                disabled={issuePoints.length < 2 || Boolean(draft)}
              />
            )}
          </FormField>
          {originNumber && (
            <FormField label={t('issuing.origin')}>
              {(a11y) => <Input {...a11y} value={originNumber} readOnly className="bg-muted/40" />}
            </FormField>
          )}
          <FormField label={t('transport.departure')} required className="sm:col-span-2">
            {(a11y) => (
              <Input
                {...a11y}
                value={departure}
                maxLength={300}
                onChange={(e) => setDeparture(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </SectionCard>

      <SectionCard title={t('transport.title')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('transport.carrierType')} required>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={carrier.idType}
                onChange={(idType) =>
                  setCarrier({ ...carrier, idType: idType as GuideContent['carrier']['idType'] })
                }
                options={carrierTypes}
              />
            )}
          </FormField>
          <FormField label={t('transport.carrierId')} required>
            {(a11y) => (
              <Input
                {...a11y}
                value={carrier.identification}
                maxLength={20}
                onChange={(e) => setCarrier({ ...carrier, identification: e.target.value })}
              />
            )}
          </FormField>
          <FormField label={t('transport.carrierName')} required>
            {(a11y) => (
              <Input
                {...a11y}
                value={carrier.name}
                maxLength={300}
                onChange={(e) => setCarrier({ ...carrier, name: e.target.value })}
              />
            )}
          </FormField>
          <FormField label={t('transport.plate')} required>
            {(a11y) => (
              <Input
                {...a11y}
                value={plate}
                maxLength={20}
                onChange={(e) => setPlate(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('transport.start')} required hint={t('transport.startHint')}>
            {(a11y) => (
              <Input
                {...a11y}
                type="date"
                value={start}
                min={today}
                onChange={(e) => setStart(e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label={t('transport.end')}
            required
            error={filled(end) && end < start ? t('transport.endBefore') : undefined}
          >
            {(a11y) => (
              <Input
                {...a11y}
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </SectionCard>

      {recipients.map((one, index) => (
        <SectionCard
          key={index}
          title={t('recipient.title', { number: index + 1 })}
          action={
            recipients.length > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRecipients((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                {t('recipient.remove', { number: index + 1 })}
              </Button>
            )
          }
        >
          <div
            role="group"
            aria-label={t('recipient.title', { number: index + 1 })}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('recipient.identification')} required>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={one.identification}
                    maxLength={20}
                    onChange={(e) => changeRecipient(index, { identification: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('recipient.name')} required>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={one.name}
                    maxLength={300}
                    onChange={(e) => changeRecipient(index, { name: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('recipient.address')} required>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={one.address}
                    maxLength={300}
                    onChange={(e) => changeRecipient(index, { address: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('recipient.reason')} required>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={one.reason}
                    maxLength={300}
                    onChange={(e) => changeRecipient(index, { reason: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t('recipient.route')}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={one.route ?? ''}
                    maxLength={300}
                    onChange={(e) => changeRecipient(index, { route: e.target.value })}
                  />
                )}
              </FormField>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">{t('support.title')}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label={t('support.number')} hint={t('support.numberHint')}>
                  {(a11y) => (
                    <Input
                      {...a11y}
                      value={one.support?.number ?? ''}
                      placeholder="001-001-000000001"
                      onChange={(e) =>
                        changeRecipient(index, {
                          support: e.target.value
                            ? {
                                number: e.target.value,
                                authorization: one.support?.authorization ?? null,
                                issueDate: one.support?.issueDate ?? today,
                              }
                            : null,
                        })
                      }
                    />
                  )}
                </FormField>
                <FormField label={t('support.authorization')}>
                  {(a11y) => (
                    <Input
                      {...a11y}
                      value={one.support?.authorization ?? ''}
                      disabled={!one.support}
                      onChange={(e) =>
                        changeRecipient(index, {
                          support: { ...one.support!, authorization: e.target.value },
                        })
                      }
                    />
                  )}
                </FormField>
                <FormField label={t('support.issueDate')}>
                  {(a11y) => (
                    <Input
                      {...a11y}
                      type="date"
                      value={one.support?.issueDate ?? ''}
                      disabled={!one.support}
                      onChange={(e) =>
                        changeRecipient(index, {
                          support: { ...one.support!, issueDate: e.target.value },
                        })
                      }
                    />
                  )}
                </FormField>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">{t('goods.title')}</p>
              <ul className="space-y-3">
                {one.lines.map((line, lineIndex) => (
                  <li key={lineIndex}>
                    <div
                      role="group"
                      aria-label={t('goods.line', { number: lineIndex + 1 })}
                      className="grid items-end gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_8rem_auto]"
                    >
                      <FormField label={t('goods.code')}>
                        {(a11y) => (
                          <Input
                            {...a11y}
                            value={line.code ?? ''}
                            maxLength={25}
                            onChange={(e) => changeLine(index, lineIndex, { code: e.target.value })}
                          />
                        )}
                      </FormField>
                      <FormField label={t('goods.name')} required>
                        {(a11y) => (
                          <Input
                            {...a11y}
                            value={line.name}
                            maxLength={300}
                            onChange={(e) => changeLine(index, lineIndex, { name: e.target.value })}
                          />
                        )}
                      </FormField>
                      <FormField label={t('goods.quantity')} required>
                        {(a11y) => (
                          <Input
                            {...a11y}
                            inputMode="decimal"
                            value={line.quantity}
                            className="text-right tabular-nums"
                            onChange={(e) =>
                              changeLine(index, lineIndex, { quantity: e.target.value })
                            }
                          />
                        )}
                      </FormField>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={one.lines.length < 2}
                        aria-label={t('goods.remove', { number: lineIndex + 1 })}
                        onClick={() =>
                          changeRecipient(index, {
                            lines: one.lines.filter((_, i) => i !== lineIndex),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => changeRecipient(index, { lines: [...one.lines, blankLine()] })}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('goods.add')}
              </Button>
            </div>
          </div>
        </SectionCard>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => setRecipients((current) => [...current, blankRecipient()])}
      >
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {t('recipient.add')}
      </Button>

      {error && (
        <Banner tone="danger" icon={AlertCircle} className="mb-0">
          {error}
        </Banner>
      )}
      <FormActionBar>
        <Button type="submit" disabled={pending || !canSend}>
          <Send className="mr-1.5 h-4 w-4" aria-hidden />
          {draft ? t('correct.submit') : t('submit')}
        </Button>
      </FormActionBar>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) setError(undefined);
        }}
        title={draft ? t('correct.confirmTitle') : t('confirmTitle')}
        description={draft ? t('correct.confirmDescription') : t('confirmDescription')}
        detail={t('confirmDetail', { plate: plate.trim(), count: recipients.length })}
        confirmLabel={draft ? t('correct.submit') : t('submit')}
        pending={pending}
        error={error}
        onConfirm={send}
      />
    </form>
  );
}
