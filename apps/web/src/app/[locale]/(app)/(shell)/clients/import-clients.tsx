'use client';

import { useLocale } from 'next-intl';
import { CsvImportDialog } from '@/components/csv-import-dialog';
import { importClientsAction } from './actions';

// FR-MD-2: clients from a spreadsheet. An identification already on file is updated.
export function ImportClients() {
  const locale = useLocale();
  const template =
    locale === 'en'
      ? 'id_type,identification,name,emails,phone,address,payment_term,payment_term_unit\n05,1710034065,Maria Perez,maria@example.com,,Quito,30,dias\n'
      : 'tipo_identificacion;identificacion;nombre;correos;telefono;direccion;plazo;unidad_plazo\n05;1710034065;María Pérez;maria@example.com;;Quito;30;dias\n';
  return (
    <CsvImportDialog
      namespace="clients.import"
      errorNamespace="clientsError"
      action={importClientsAction}
      template={template}
    />
  );
}
