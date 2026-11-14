'use client';

import { useLocale } from 'next-intl';
import { CsvImportDialog } from '@/components/csv-import-dialog';
import { importClientsAction } from './actions';

// FR-MD-2: clients from a spreadsheet. An identification already on file is updated.
export function ImportClients() {
  const locale = useLocale();
  const template =
    locale === 'en'
      ? 'id_type,identification,name,emails,phone,address,payment_term,payment_term_unit\n05,1712345675,Example client (replace this line),client@example.com,,Quito,30,dias\n'
      : 'tipo_identificacion;identificacion;nombre;correos;telefono;direccion;plazo;unidad_plazo\n05;1712345675;Cliente de ejemplo (reemplaza esta línea);cliente@example.com;;Quito;30;dias\n';
  return (
    <CsvImportDialog
      namespace="clients.import"
      errorNamespace="clientsError"
      action={importClientsAction}
      template={template}
    />
  );
}
