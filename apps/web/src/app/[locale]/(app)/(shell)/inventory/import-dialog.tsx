'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@comprobify/ui/components/dialog';
import { toast } from '@comprobify/ui/components/sonner';
import { Download, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormField } from '@/components/form-field';
import { ScrollDialogContent } from '@/components/scroll-dialog-content';
import { importOpeningAction, type ImportState } from './actions';

// FR-INV-3: opening balances from a spreadsheet. Nothing is applied unless every line is right,
// so the dialog lists what to fix and the person sends the file again.
export function ImportDialog({ multipleWarehouses }: { multipleWarehouses: boolean }) {
  const t = useTranslations('inventory.import');
  const tError = useTranslations('inventoryError');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportState>();
  const [pending, startTransition] = useTransition();
  // Spanish Excel opens semicolon files in columns; the English one, comma files.
  const template =
    locale === 'en'
      ? `code,${multipleWarehouses ? 'branch,' : ''}quantity,unit_cost\nP-001,${multipleWarehouses ? '001,' : ''}10,2.50\n`
      : `codigo;${multipleWarehouses ? 'sucursal;' : ''}cantidad;costo_unitario\nP-001;${multipleWarehouses ? '001;' : ''}10;2,50\n`;

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
      const state = await importOpeningAction(locale, await file.text());
      if (state.imported) {
        toast.success(t('done', { count: state.imported }));
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
            <DialogDescription>
              {multipleWarehouses ? t('descriptionBranches') : t('description')}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
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
                {tError.has(result.error) ? tError(result.error) : tError('UNKNOWN')}
              </p>
            )}
            {result?.problems && result.problems.length > 0 && (
              <div role="alert" className="text-sm">
                <p className="font-medium text-destructive">
                  {t('problems', { count: result.problems.length })}
                </p>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {result.problems.map((problem) => (
                    <li key={`${problem.line}-${problem.code}`}>
                      <span className="tabular-nums">{t('line', { line: problem.line })}</span>{' '}
                      {t(`problem.${problem.code}`)}
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
