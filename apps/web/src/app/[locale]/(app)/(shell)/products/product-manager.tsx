'use client';

import { Button } from '@comprobify/ui/components/button';
import { Input } from '@comprobify/ui/components/input';
import { Switch } from '@comprobify/ui/components/switch';
import { Textarea } from '@comprobify/ui/components/textarea';
import { cn } from '@comprobify/ui/lib/utils';
import { Archive, Boxes, Pencil, Plus, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ChoiceSelect, type Choice } from '@/components/choice-select';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
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
import { saveProductAction, setProductActiveAction } from './actions';

export type ProductRow = {
  id: string;
  code: string;
  auxiliaryCode: string | null;
  name: string;
  description: string | null;
  kind: string;
  unit: string | null;
  price: string;
  priceShown: string;
  cost: string | null;
  ivaRateCode: string;
  ivaLabel: string;
  tracksStock: boolean;
  additionalDetails: { name: string; value: string }[];
  active: boolean;
};

const iconButton =
  'rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40';

export function ProductManager({
  products,
  kinds,
  ivaRates,
  canManage,
  searching,
}: {
  products: ProductRow[];
  kinds: Choice[];
  ivaRates: Choice[];
  canManage: boolean;
  searching: boolean;
}) {
  const t = useTranslations('products');
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);
  const [toggling, setToggling] = useState<ProductRow | null>(null);
  const kindLabel = new Map(kinds.map((kind) => [kind.value, kind.label]));
  const toggle = useServerAction(setProductActiveAction, {
    errors: 'productsError',
    success: toggling?.active ? t('deactivated') : t('reactivated'),
    onDone: () => setToggling(null),
  });

  return (
    <>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            {t('new')}
          </Button>
        </div>
      )}
      <TableCard>
        {products.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={searching ? t('noMatchesTitle') : t('emptyTitle')}
            description={searching ? t('noMatches') : t('empty')}
          />
        ) : (
          <StackTable aria-label={t('title')}>
            <StackHeader>
              <StackRow className="bg-muted/40">
                <StackHead className="pl-4">{t('table.name')}</StackHead>
                <StackHead>{t('table.kind')}</StackHead>
                <StackHead className="text-right">{t('table.price')}</StackHead>
                <StackHead>{t('table.iva')}</StackHead>
                <StackHead>{t('table.status')}</StackHead>
                {canManage && (
                  <StackHead className="pr-4 text-right">{t('table.actions')}</StackHead>
                )}
              </StackRow>
            </StackHeader>
            <StackBody>
              {products.map((product) => (
                <StackRow key={product.id}>
                  <StackCell heading className="pl-4">
                    <p className={cn('font-medium', !product.active && 'text-muted-foreground')}>
                      {product.name}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{product.code}</p>
                  </StackCell>
                  <StackCell label={t('table.kind')} className="text-sm">
                    {kindLabel.get(product.kind)}
                  </StackCell>
                  <StackCell label={t('table.price')} className="text-right tabular-nums">
                    {product.priceShown}
                  </StackCell>
                  <StackCell label={t('table.iva')}>
                    <ToneBadge tone="neutral">{product.ivaLabel}</ToneBadge>
                  </StackCell>
                  <StackCell label={t('table.status')}>
                    {product.active ? (
                      <ToneBadge tone="success">{t('active')}</ToneBadge>
                    ) : (
                      <ToneBadge tone="neutral">{t('inactive')}</ToneBadge>
                    )}
                  </StackCell>
                  {canManage && (
                    <StackCell className="pr-4">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => setEditing(product)}
                          title={t('edit')}
                          aria-label={t('editName', { name: product.name })}
                          className={iconButton}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setToggling(product)}
                          title={product.active ? t('deactivate') : t('reactivate')}
                          aria-label={
                            product.active
                              ? t('deactivateName', { name: product.name })
                              : t('reactivateName', { name: product.name })
                          }
                          className={iconButton}
                        >
                          {product.active ? (
                            <Archive className="h-4 w-4" aria-hidden />
                          ) : (
                            <RotateCcw className="h-4 w-4" aria-hidden />
                          )}
                        </button>
                      </div>
                    </StackCell>
                  )}
                </StackRow>
              ))}
            </StackBody>
          </StackTable>
        )}
      </TableCard>

      {editing && (
        <ProductDialog
          product={editing === 'new' ? null : editing}
          kinds={kinds}
          ivaRates={ivaRates}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(open) => {
          if (!open) {
            setToggling(null);
            toggle.clearError();
          }
        }}
        title={toggling?.active ? t('deactivateTitle') : t('reactivateTitle')}
        description={toggling?.active ? t('deactivateDescription') : t('reactivateDescription')}
        detail={toggling?.name}
        confirmLabel={toggling?.active ? t('deactivate') : t('reactivate')}
        destructive={toggling?.active}
        pending={toggle.pending}
        error={toggle.error}
        onConfirm={() =>
          toggling && toggle.run({ id: toggling.id, active: String(!toggling.active) })
        }
      />
    </>
  );
}

function ProductDialog({
  product,
  kinds,
  ivaRates,
  onClose,
}: {
  product: ProductRow | null;
  kinds: Choice[];
  ivaRates: Choice[];
  onClose: () => void;
}) {
  const t = useTranslations('products');
  const uid = useId();
  const [kind, setKind] = useState(product?.kind ?? 'GOOD');
  const [iva, setIva] = useState(product?.ivaRateCode ?? '4');
  const [tracksStock, setTracksStock] = useState(product?.tracksStock ?? false);
  // An old product may carry a rate no longer offered: it stays shown until changed.
  const rateOptions =
    product && !ivaRates.some((rate) => rate.value === product.ivaRateCode)
      ? [...ivaRates, { value: product.ivaRateCode, label: product.ivaLabel }]
      : ivaRates;
  const details = [0, 1, 2].map((index) => product?.additionalDetails[index]);
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={product ? t('editName', { name: product.name }) : t('new')}
      submitLabel={product ? t('save') : t('create')}
      action={saveProductAction}
      errors="productsError"
      success={product ? t('saved') : t('created')}
      extra={{
        ...(product ? { id: product.id } : {}),
        kind,
        ivaRateCode: iva,
        ...(tracksStock ? { tracksStock: 'on' } : {}),
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('code')} hint={t('codeHint')} required>
          {(props) => (
            <Input
              {...props}
              name="code"
              defaultValue={product?.code}
              required
              maxLength={25}
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField label={t('auxiliaryCode')}>
          {(props) => (
            <Input
              {...props}
              name="auxiliaryCode"
              defaultValue={product?.auxiliaryCode ?? ''}
              maxLength={25}
            />
          )}
        </FormField>
      </div>
      <FormField label={t('name')} hint={t('nameHint')} required>
        {(props) => (
          <Input {...props} name="name" defaultValue={product?.name} required maxLength={300} />
        )}
      </FormField>
      <FormField label={t('description')}>
        {(props) => (
          <Textarea
            {...props}
            name="description"
            defaultValue={product?.description ?? ''}
            maxLength={1000}
            rows={2}
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('kind')} required>
          {(props) => <ChoiceSelect value={kind} onChange={setKind} options={kinds} a11y={props} />}
        </FormField>
        <FormField label={t('unit')} hint={t('unitHint')}>
          {(props) => (
            <Input {...props} name="unit" defaultValue={product?.unit ?? ''} maxLength={50} />
          )}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label={t('price')} hint={t('priceHint')} required>
          {(props) => (
            <Input
              {...props}
              name="price"
              inputMode="decimal"
              pattern="\d{1,12}([.,]\d{1,6})?"
              defaultValue={product?.price}
              required
            />
          )}
        </FormField>
        <FormField label={t('cost')}>
          {(props) => (
            <Input
              {...props}
              name="cost"
              inputMode="decimal"
              pattern="\d{1,12}([.,]\d{1,6})?"
              defaultValue={product?.cost ?? ''}
            />
          )}
        </FormField>
        <FormField label={t('iva')} required>
          {(props) => (
            <ChoiceSelect value={iva} onChange={setIva} options={rateOptions} a11y={props} />
          )}
        </FormField>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id={`${uid}-stock`} className="text-sm font-medium">
            {t('tracksStock')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t('tracksStockHint')}</p>
        </div>
        <Switch
          checked={tracksStock}
          onCheckedChange={setTracksStock}
          aria-labelledby={`${uid}-stock`}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('details')}</legend>
        <p className="text-xs text-muted-foreground">{t('detailsHint')}</p>
        {details.map((detail, index) => (
          <div key={index} className="grid grid-cols-2 gap-2">
            <Input
              name="detailName"
              aria-label={t('detailName', { number: index + 1 })}
              placeholder={t('detailNamePlaceholder')}
              defaultValue={detail?.name ?? ''}
              maxLength={300}
            />
            <Input
              name="detailValue"
              aria-label={t('detailValue', { number: index + 1 })}
              placeholder={t('detailValuePlaceholder')}
              defaultValue={detail?.value ?? ''}
              maxLength={300}
            />
          </div>
        ))}
      </fieldset>
    </FormDialog>
  );
}
