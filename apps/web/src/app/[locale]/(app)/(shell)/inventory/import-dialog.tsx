'use client';

import { useLocale } from 'next-intl';
import { CsvImportDialog } from '@/components/csv-import-dialog';
import { importCountAction, importOpeningAction } from './actions';

// FR-INV-3: opening balances from a spreadsheet, on the shared upload screen. Nothing is applied
// unless every line is right.
export function ImportDialog({ multipleWarehouses }: { multipleWarehouses: boolean }) {
  const locale = useLocale();
  // Spanish Excel opens semicolon files in columns; the English one, comma files.
  const template =
    locale === 'en'
      ? `code,${multipleWarehouses ? 'branch,' : ''}quantity,unit_cost\nP-001,${multipleWarehouses ? '001,' : ''}10,2.50\n`
      : `codigo;${multipleWarehouses ? 'sucursal;' : ''}cantidad;costo_unitario\nP-001;${multipleWarehouses ? '001;' : ''}10;2,50\n`;
  return (
    <CsvImportDialog
      namespace="inventory.import"
      errorNamespace="inventoryError"
      action={importOpeningAction}
      template={template}
      descriptionKey={multipleWarehouses ? 'descriptionBranches' : 'description'}
    />
  );
}

// ADR-046: a physical count from a spreadsheet: what each warehouse holds, the books adjusted to it.
export function CountDialog({ multipleWarehouses }: { multipleWarehouses: boolean }) {
  const locale = useLocale();
  const template =
    locale === 'en'
      ? `code,${multipleWarehouses ? 'branch,' : ''}counted\nP-001,${multipleWarehouses ? '001,' : ''}12\n`
      : `codigo;${multipleWarehouses ? 'sucursal;' : ''}contado\nP-001;${multipleWarehouses ? '001;' : ''}12\n`;
  return (
    <CsvImportDialog
      namespace="inventory.count"
      errorNamespace="inventoryError"
      action={importCountAction}
      template={template}
      descriptionKey={multipleWarehouses ? 'descriptionBranches' : 'description'}
      withReason
    />
  );
}
