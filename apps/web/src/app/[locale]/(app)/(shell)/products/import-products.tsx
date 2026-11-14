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
      ? 'code,name,type,price,cost,iva_code,tracks_stock,unit\nEX-1,Example product (replace this line),good,10.00,6.00,4,yes,unit\nEX-2,Example service (replace this line),service,20.00,,4,no,\n'
      : 'codigo;nombre;tipo;precio;costo;iva;controla_stock;unidad\nEJ-1;Producto de ejemplo (reemplaza esta línea);bien;10,00;6,00;4;si;unidad\nEJ-2;Servicio de ejemplo (reemplaza esta línea);servicio;20,00;;4;no;\n';
  return (
    <CsvImportDialog
      namespace="products.import"
      errorNamespace="productsError"
      action={importProductsAction}
      template={template}
    />
  );
}
