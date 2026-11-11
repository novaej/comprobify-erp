'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Textarea } from '@comprobify/ui/components/textarea';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import {
  StackBody,
  StackCell,
  StackHead,
  StackHeader,
  StackRow,
  StackTable,
  TableCard,
} from '@/components/stack-table';
import { ToneBadge } from '@/components/tone-badge';
import { useServerAction } from '@/components/use-server-action';
import {
  discardAction,
  draftFromVersionAction,
  previewAction,
  publishAction,
  saveDraftAction,
  sendTestAction,
  type PreviewState,
} from '../../actions';

type Fields = { subject: string; heading: string; body: string; button: string; footer: string };

type Version = { version: number; status: string; when: string; author: string | null };

const STATUS_TONE = { PUBLISHED: 'success', DRAFT: 'warning', DISCARDED: 'neutral' } as const;

// FR-NOT-3, FR-ADM-4 (ADR-037): the text of one email, structured: the layout is code, so a text
// can't break the email. Saving makes a draft, a preview and a test show it as it would be sent,
// and only publishing changes what companies receive.
export function EmailEditor({
  template,
  language,
  placeholders,
  initial,
  draftVersion,
  inUseVersion,
  versions,
}: {
  template: string;
  language: string;
  placeholders: { allowed: string[]; required: string[] };
  initial: Fields;
  draftVersion: number | null;
  inUseVersion: number | null;
  versions: Version[];
}) {
  const t = useTranslations('adminEmails.editor');
  const tStatus = useTranslations('adminEmails.status');
  const locale = useLocale();
  const [fields, setFields] = useState<Fields>(initial);
  const [saved, setSaved] = useState<Fields>(initial);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewing, startPreview] = useTransition();
  const [dialog, setDialog] = useState<'publish' | 'discard' | null>(null);
  const tError = useTranslations('adminError');
  const dirty = (Object.keys(fields) as (keyof Fields)[]).some(
    (name) => fields[name] !== saved[name],
  );
  const hasDraft = draftVersion !== null;

  const form = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set('locale', locale);
    data.set('template', template);
    data.set('language', language);
    for (const [name, value] of Object.entries({ ...fields, ...extra })) data.set(name, value);
    return data;
  };
  const save = useServerAction(saveDraftAction, {
    errors: 'adminError',
    success: t('saved'),
    onDone: () => setSaved(fields),
  });
  const test = useServerAction(sendTestAction, { errors: 'adminError', success: t('testSent') });
  const publish = useServerAction(publishAction, {
    errors: 'adminError',
    success: t('published'),
    onDone: () => setDialog(null),
  });
  const discard = useServerAction(discardAction, {
    errors: 'adminError',
    success: t('discarded'),
    onDone: () => setDialog(null),
  });
  const restore = useServerAction(draftFromVersionAction, {
    errors: 'adminError',
    success: t('restored'),
  });

  const set = (name: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [name]: value }));
  const showPreview = () => startPreview(async () => setPreview(await previewAction(form())));
  const placeholderList = (names: string[]) =>
    names.length === 0 ? t('none') : names.map((name) => `{${name}}`).join(' ');

  return (
    <>
      <SectionCard
        title={t('title')}
        description={t('description')}
        action={
          <>
            {inUseVersion !== null && (
              <ToneBadge tone="success">{t('inUse', { version: inUseVersion })}</ToneBadge>
            )}
            {hasDraft && (
              <ToneBadge tone="warning">{t('draft', { version: draftVersion })}</ToneBadge>
            )}
          </>
        }
      >
        <dl className="mb-4 grid gap-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('allowed')}</dt>
            <dd className="mt-0.5 font-mono break-words">
              {placeholderList(placeholders.allowed)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('required')}</dt>
            <dd className="mt-0.5 font-mono break-words">
              {placeholderList(placeholders.required)}
            </dd>
          </div>
        </dl>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.run(form());
          }}
        >
          <FormField label={t('subject')} required>
            {(a11y) => (
              <Input
                {...a11y}
                value={fields.subject}
                onChange={(event) => set('subject')(event.target.value)}
                maxLength={200}
                required
              />
            )}
          </FormField>
          <FormField label={t('heading')} required>
            {(a11y) => (
              <Input
                {...a11y}
                value={fields.heading}
                onChange={(event) => set('heading')(event.target.value)}
                maxLength={200}
                required
              />
            )}
          </FormField>
          <FormField label={t('body')} required>
            {(a11y) => (
              <Textarea
                {...a11y}
                rows={5}
                value={fields.body}
                onChange={(event) => set('body')(event.target.value)}
                maxLength={2000}
                required
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('button')} required>
              {(a11y) => (
                <Input
                  {...a11y}
                  value={fields.button}
                  onChange={(event) => set('button')(event.target.value)}
                  maxLength={60}
                  required
                />
              )}
            </FormField>
            <FormField label={t('footer')} hint={t('footerHint')}>
              {(a11y) => (
                <Textarea
                  {...a11y}
                  rows={2}
                  value={fields.footer}
                  onChange={(event) => set('footer')(event.target.value)}
                  maxLength={500}
                />
              )}
            </FormField>
          </div>
          {(save.error || test.error || restore.error) && (
            <p role="alert" className="text-sm text-destructive">
              {save.error ?? test.error ?? restore.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={save.pending || !dirty}>
              {t('save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={showPreview}
              disabled={previewing}
            >
              {t('preview')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={test.pending}
              onClick={() => test.run(form())}
            >
              {t('test')}
            </Button>
            {hasDraft && (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={dirty}
                  title={dirty ? t('saveFirst') : undefined}
                  onClick={() => setDialog('publish')}
                >
                  {t('publish')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDialog('discard')}
                >
                  {t('discard')}
                </Button>
              </>
            )}
          </div>
          {dirty && <p className="text-xs text-muted-foreground">{t('unsaved')}</p>}
        </form>
      </SectionCard>

      {preview && (
        <SectionCard title={t('previewTitle')} description={t('previewDescription')}>
          {'error' in preview ? (
            <p role="alert" className="text-sm text-destructive">
              {tError.has(preview.error) ? tError(preview.error) : tError('UNKNOWN')}
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">{t('subject')}: </span>
                <span className="font-medium">{preview.subject}</span>
              </p>
              {/* The email as sent, in a sandbox with no scripts, so a text can't run anything. */}
              <iframe
                title={t('previewFrame')}
                sandbox=""
                srcDoc={preview.html}
                className="h-80 w-full rounded-md border border-border bg-white"
              />
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard title={t('historyTitle')} description={t('historyDescription')}>
        <TableCard className="mt-1">
          <StackTable aria-label={t('historyTitle')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('versionColumn')}</StackHead>
                <StackHead>{t('statusColumn')}</StackHead>
                <StackHead>{t('whenColumn')}</StackHead>
                <StackHead>{t('authorColumn')}</StackHead>
                <StackHead>
                  <span className="sr-only">{t('actionsColumn')}</span>
                </StackHead>
              </StackRow>
            </StackHeader>
            <StackBody>
              {versions.map((row) => (
                <StackRow key={row.version}>
                  <StackCell heading className="pl-4 tabular-nums">
                    {t('versionLabel', { version: row.version })}
                  </StackCell>
                  <StackCell label={t('statusColumn')}>
                    <ToneBadge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE]}>
                      {row.version === inUseVersion
                        ? tStatus('IN_USE')
                        : tStatus(row.status as 'DRAFT')}
                    </ToneBadge>
                  </StackCell>
                  <StackCell label={t('whenColumn')}>{row.when}</StackCell>
                  <StackCell label={t('authorColumn')}>{row.author ?? '—'}</StackCell>
                  <StackCell className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={restore.pending}
                      onClick={() => restore.run(form({ version: String(row.version) }))}
                    >
                      {t('useAsDraft')}
                      <span className="sr-only">
                        {' '}
                        {t('useAsDraftFor', { version: row.version })}
                      </span>
                    </Button>
                  </StackCell>
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        </TableCard>
      </SectionCard>

      <ConfirmDialog
        open={dialog === 'publish'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('publishTitle')}
        description={t('publishDescription')}
        confirmLabel={t('publish')}
        pending={publish.pending}
        error={publish.error}
        onConfirm={() => publish.run(form())}
      />
      <ConfirmDialog
        open={dialog === 'discard'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('discardTitle')}
        description={t('discardDescription')}
        confirmLabel={t('discard')}
        destructive
        pending={discard.pending}
        error={discard.error}
        onConfirm={() => discard.run(form())}
      />
    </>
  );
}
