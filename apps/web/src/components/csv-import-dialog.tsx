'use client';

import { readCsvFile } from '@/lib/read-csv';
import { Button } from '@comprobify/ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comprobify/ui/components/dialog';
import { Input } from '@comprobify/ui/components/input';
import { toast } from '@comprobify/ui/components/sonner';
import { Download, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormField } from '@/components/form-field';
import { ScrollDialogContent } from '@/components/scroll-dialog-content';

// What an import answers: how many it made, or the lines to fix. Nothing is applied unless every
// line is right, so the dialog lists them and the person sends the file again.
export type CsvImportState = {
  error?: string;
  imported?: number;
  created?: number;
  updated?: number;
  problems?: { line: number; code: string; field?: string }[];
};

// The one upload screen every CSV import uses (FR-MD-1, FR-MD-2, FR-INV-3). Its texts come from
// the namespace the caller names: title, description, template, file, submit, done and the
// `problem.<code>` and `field.<column>` lines.
export function CsvImportDialog({
  namespace,
  errorNamespace,
  action,
  template,
  descriptionKey = 'description',
}: {
  namespace: 'inventory.import' | 'products.import' | 'clients.import';
  errorNamespace: 'inventoryError' | 'productsError' | 'clientsError';
  action: (locale: string, content: string) => Promise<CsvImportState>;
  // The file offered as a model, in the person's language.
  template: string;
  descriptionKey?: 'description' | 'descriptionBranches';
}) {
  const t = useTranslations(namespace);
  const tError = useTranslations(errorNamespace);
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvImportState>();
  const [pending, startTransition] = useTransition();
  const say = t as unknown as (key: string, values?: Record<string, unknown>) => string;

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setFile(null);
      setResult(undefined);
    }
  };
  const send = () => {
    if (!file) return;
    startTransition(async () => {
      const state = await action(locale, await readCsvFile(file));
      const made = (state.imported ?? 0) + (state.created ?? 0) + (state.updated ?? 0);
      if (made > 0) {
        toast.success(
          say('done', {
            count: state.imported ?? 0,
            created: state.created ?? 0,
            updated: state.updated ?? 0,
          }),
        );
        close(false);
        return;
      }
      setResult(state);
    });
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload className="mr-1.5 h-4 w-4" aria-hidden />
        {t('open')}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <ScrollDialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t(descriptionKey)}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <a
              // The byte order mark, as in the exports: Excel reads a UTF-8 file without it as another
              // encoding and shows "línea" as "l√≠nea".
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${template}`)}`}
              download={t('templateFile')}
              className="inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-4 hover:underline"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t('template')}
            </a>
            <FormField label={t('file')} hint={t('fileHint')} required>
              {(a11y) => (
                <Input
                  {...a11y}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setResult(undefined);
                  }}
                />
              )}
            </FormField>
            {result?.error && (
              <p role="alert" className="text-sm text-destructive">
                {tError.has(result.error as 'UNKNOWN')
                  ? tError(result.error as 'UNKNOWN')
                  : tError('UNKNOWN')}
              </p>
            )}
            {result?.problems && result.problems.length > 0 && (
              <div role="alert" className="text-sm">
                <p className="font-medium text-destructive">
                  {t('problems', { count: result.problems.length })}
                </p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {result.problems.map((problem) => (
                    <li key={`${problem.line}-${problem.code}-${problem.field ?? ''}`}>
                      <span className="tabular-nums">{t('line', { line: problem.line })}</span>{' '}
                      {say(`problem.${problem.code}`, {
                        field:
                          problem.field && t.has(`field.${problem.field}` as never)
                            ? say(`field.${problem.field}`)
                            : (problem.field ?? ''),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={!file || pending}>
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        </ScrollDialogContent>
      </Dialog>
    </>
  );
}
