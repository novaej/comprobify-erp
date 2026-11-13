'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { FormActionBar } from '@/components/form-action-bar';
import { goLiveAction } from './actions';

export type StartingPoint = { key: string; label: string; current: number };
export type MasterDataCounts = {
  products: number;
  clients: number;
  providers: number;
  templates: number;
};

// The box is the confirmation: it can't be undone, so it is read before the button.
export function GoLiveForm({
  points,
  masterData,
}: {
  points: StartingPoint[];
  // What the twin holds, active rows only; none hides the offer.
  masterData: MasterDataCounts;
}) {
  const t = useTranslations('goLive');
  return (
    <ActionForm action={goLiveAction} errors="goLiveError">
      {(pending) => (
        <>
          {Object.values(masterData).some((count) => count > 0) && (
            <div className="mt-6 border-t border-border pt-6">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="copyMasterData"
                  defaultChecked
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block font-semibold">{t('copyTitle')}</span>
                  <span className="block">{t('copyLabel', masterData)}</span>
                  <span className="mt-1 block text-muted-foreground">{t('copyNote')}</span>
                </span>
              </label>
            </div>
          )}
          {points.length > 0 && (
            // The border is on a wrapper: a fieldset draws its legend across its own border.
            <div className="mt-6 border-t border-border pt-6">
              <fieldset className="space-y-3">
                <legend className="mb-1 text-sm font-semibold">{t('startingTitle')}</legend>
                <p className="text-sm text-muted-foreground">{t('startingDescription')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {points.map((point) => (
                    <label
                      key={point.key}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{point.label}</span>
                      <Input
                        name={`seq:${point.key}`}
                        type="number"
                        min={point.current}
                        max={999999999}
                        step={1}
                        defaultValue={point.current}
                        className="w-36 text-right tabular-nums"
                        aria-label={t('startingFor', { point: point.label })}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          <FormActionBar
            summary={
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  name="confirm"
                  required
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                {t('confirm')}
              </label>
            }
          >
            <Button type="submit" disabled={pending}>
              {pending ? t('submitting') : t('submit')}
            </Button>
          </FormActionBar>
        </>
      )}
    </ActionForm>
  );
}
