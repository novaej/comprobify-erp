'use client';

import { useLocale } from 'next-intl';
import { CsvImportDialog } from '@/components/csv-import-dialog';
import { importProductsAction } from './actions';

// FR-MD-1: products from a spreadsheet. A code already in the catalogue is updated.
export function ImportProducts() {
  const locale = useLocale();
  // Spanish Excel opens semicolon files in columns; the English one, comma files.
  const template =
    locale === 'en'
      ? 'code,name,type,price,cost,iva_code,tracks_stock,unit\nCAF-1,Ground coffee,good,5.50,2.25,4,yes,kg\nSRV-1,Installation,service,30,,0,no,\n'
      : 'codigo;nombre;tipo;precio;costo;iva;controla_stock;unidad\nCAF-1;Café molido;bien;5,50;2,25;4;si;kg\nSRV-1;Instalación;servicio;30;;0;no;\n';
  return (
    <CsvImportDialog
      namespace="products.import"
      errorNamespace="productsError"
      action={importProductsAction}
      template={template}
    />
  );
}
