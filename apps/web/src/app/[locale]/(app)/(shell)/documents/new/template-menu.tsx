'use client';

import { Button } from '@comprobify/ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@comprobify/ui/components/dialog';
import { Input } from '@comprobify/ui/components/input';
import { toast } from '@comprobify/ui/components/sonner';
import { FolderOpen, Save, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Banner } from '@/components/banner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form-field';
import { ScrollDialogContent } from '@/components/scroll-dialog-content';
import { useServerAction } from '@/components/use-server-action';
import { removeTemplateAction, saveTemplateAction } from './actions';

export type TemplateOption<Content> = { id: string; name: string; content: Content };

// FR-MD-5: load a saved invoice into the form, or save the form as one.
export function TemplateMenu<Content>({
  templates,
  current,
  canSave,
  describe,
  onLoad,
}: {
  templates: TemplateOption<Content>[];
  // What the form holds now, for saving.
  current: () => Content;
  canSave: boolean;
  // A line under each template's name: its client, lines and total.
  describe: (content: Content) => string;
  onLoad: (template: TemplateOption<Content>) => void;
}) {
  const t = useTranslations('invoiceForm.templates');
  const [open, setOpen] = useState<'load' | 'save' | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<TemplateOption<Content> | null>(null);
  const remove = useServerAction(removeTemplateAction, {
    errors: 'documentsError',
    success: t('removed'),
    onDone: () => setRemoving(null),
  });
  const taken = templates.some(
    (template) =>
      template.name.trim().toLocaleLowerCase('es') === name.trim().toLocaleLowerCase('es'),
  );

  return (
    <div className="mb-6 flex flex-wrap justify-end gap-2">
      {templates.length > 0 && (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen('load')}>
          <FolderOpen className="mr-1.5 h-4 w-4" aria-hidden />
          {t('load')}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canSave}
        onClick={() => {
          setName('');
          setOpen('save');
        }}
      >
        <Save className="mr-1.5 h-4 w-4" aria-hidden />
        {t('save')}
      </Button>

      <Dialog open={open === 'load'} onOpenChange={(next) => setOpen(next ? 'load' : null)}>
        <ScrollDialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('loadTitle')}</DialogTitle>
            <DialogDescription>{t('loadDescription')}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex items-start gap-2 rounded-lg border border-border p-1"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    onLoad(template);
                    setOpen(null);
                    toast.success(t('loaded'));
                  }}
                >
                  <span className="block font-medium">{template.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {describe(template.content)}
                  </span>
                </button>
                <button
                  type="button"
                  title={t('remove', { name: template.name })}
                  aria-label={t('remove', { name: template.name })}
                  onClick={() => setRemoving(template)}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </ScrollDialogContent>
      </Dialog>

      <FormDialog
        open={open === 'save'}
        onOpenChange={(next) => setOpen(next ? 'save' : null)}
        title={t('saveTitle')}
        description={t('saveDescription')}
        submitLabel={t('save')}
        action={saveTemplateAction}
        errors="documentsError"
        success={t('saved')}
        extra={{ content: JSON.stringify(current()) }}
      >
        <FormField label={t('name')} required>
          {(a11y) => (
            <Input
              {...a11y}
              name="name"
              required
              maxLength={100}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>
        {taken && (
          <Banner tone="warning" icon={Save} role="note" className="mb-0">
            {t('replaceWarning')}
          </Banner>
        )}
      </FormDialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRemoving(null);
            remove.clearError();
          }
        }}
        title={t('removeTitle')}
        description={t('removeDescription')}
        detail={removing?.name}
        confirmLabel={t('removeConfirm')}
        destructive
        pending={remove.pending}
        error={remove.error}
        onConfirm={() => removing && remove.run({ id: removing.id })}
      />
    </div>
  );
}
