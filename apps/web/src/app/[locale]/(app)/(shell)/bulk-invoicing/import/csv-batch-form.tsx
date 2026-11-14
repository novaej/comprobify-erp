'use client';

import { readCsvFile } from '@/lib/read-csv';
import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { AlertCircle, Download, Layers } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Banner } from '@/components/banner';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { FormActionBar } from '@/components/form-action-bar';
import { FormField } from '@/components/form-field';
import { SectionCard } from '@/components/section-card';
import { startCsvBatchAction, type CsvBatchState } from '../actions';

// FR-BULK-1: how the invoices are paid and the file they come from. Nothing starts unless every
// row is right, so the rows to fix are listed here and the person sends the file again.
export function CsvBatchForm({
  issuePoints,
  paymentMethods,
  termUnits,
}: {
  issuePoints: Choice[];
  paymentMethods: Choice[];
  termUnits: Choice[];
}) {
  const t = useTranslations('bulkInvoicing');
  const tCsv = useTranslations('bulkInvoicing.csv');
  const tError = useTranslations('bulkInvoicingError');
  const tDocError = useTranslations('documentsError');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [issuePointId, setIssuePointId] = useState(issuePoints[0]?.value ?? '');
  const [method, setMethod] = useState(paymentMethods[0]?.value ?? '01');
  const [term, setTerm] = useState('');
  const [termUnit, setTermUnit] = useState(termUnits[0]?.value ?? 'dias');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvBatchState>();
  const say = tCsv as unknown as (key: string, values?: Record<string, unknown>) => string;

  const termInvalid = term.trim() !== '' && !/^\d{1,4}$/.test(term.trim());
  const ready = issuePointId !== '' && !termInvalid && file !== null;
  // Spanish Excel opens semicolon files in columns; the English one, comma files.
  const template =
    locale === 'en'
      ? 'reference,client,product,quantity,unit_price,discount\nF-001,1710034065,CAF-1,2,,\nF-001,1710034065,TE-1,1,,\nF-002,,CAF-1,3,4.50,\n'
      : 'referencia;cliente;producto;cantidad;precio;descuento\nF-001;1710034065;CAF-1;2;;\nF-001;1710034065;TE-1;1;;\nF-002;;CAF-1;3;4,50;\n';

  const send = () => {
    if (!file) return;
    startTransition(async () => {
      // Success redirects to the batch; only a refusal or the rows to fix come back.
      const state = await startCsvBatchAction(locale, {
        content: await readCsvFile(file),
        issuePointId,
        method,
        term,
        termUnit,
      });
      setResult(state ?? undefined);
    });
  };
  const errorText = result?.error
    ? tError.has(result.error as 'UNKNOWN')
      ? tError(result.error as 'UNKNOWN')
      : tDocError.has(result.error as 'UNKNOWN')
        ? tDocError(result.error as 'UNKNOWN')
        : tError('UNKNOWN')
    : null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setResult(undefined);
        if (ready) send();
      }}
      className="space-y-6"
    >
      <SectionCard title={t('form.title')} description={tCsv('formDescription')}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_8rem]">
          <FormField label={t('form.issuePoint')} required>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={issuePointId}
                onChange={setIssuePointId}
                options={issuePoints}
              />
            )}
          </FormField>
          <FormField label={t('form.method')}>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={method}
                onChange={setMethod}
                options={paymentMethods}
              />
            )}
          </FormField>
          <FormField label={t('form.term')} error={termInvalid ? t('form.termInvalid') : undefined}>
            {(a11y) => (
              <Input
                {...a11y}
                inputMode="numeric"
                className="text-right tabular-nums"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('form.termUnit')}>
            {(a11y) => (
              <ChoiceSelect
                a11y={a11y}
                value={termUnit}
                onChange={setTermUnit}
                options={termUnits}
                disabled={term.trim() === ''}
              />
            )}
          </FormField>
        </div>
      </SectionCard>

      <SectionCard title={tCsv('fileTitle')} description={tCsv('fileDescription')}>
        <div className="flex flex-col gap-4">
          <a
            // With the byte order mark, as the exports have: Excel shows the accents correctly.
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${template}`)}`}
            download={tCsv('templateFile')}
            className="inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-4 hover:underline"
          >
            <Download className="h-4 w-4" aria-hidden />
            {tCsv('template')}
          </a>
          <FormField label={tCsv('file')} hint={tCsv('fileHint')} required>
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
        </div>
      </SectionCard>

      {errorText && (
        <Banner tone="danger" icon={AlertCircle} role="alert" className="mb-0">
          {errorText}
        </Banner>
      )}
      {result?.problems && result.problems.length > 0 && (
        <Banner
          tone="danger"
          icon={AlertCircle}
          role="alert"
          title={tCsv('problems', { count: result.problems.length })}
          className="mb-0"
        >
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {result.problems.map((problem) => (
              <li key={`${problem.line}-${problem.code}-${problem.field ?? ''}`}>
                <span className="tabular-nums">{tCsv('line', { line: problem.line })}</span>{' '}
                {say(`problem.${problem.code}`, {
                  field:
                    problem.field && tCsv.has(`field.${problem.field}` as never)
                      ? say(`field.${problem.field}`)
                      : (problem.field ?? ''),
                })}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      <FormActionBar summary={file ? file.name : tCsv('noFile')}>
        <Button type="submit" disabled={pending || !ready}>
          <Layers className="mr-1.5 h-4 w-4" aria-hidden />
          {tCsv('submit')}
        </Button>
      </FormActionBar>
    </form>
  );
}
