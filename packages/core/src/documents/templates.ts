import { and, asc, eq, schema, sql, type Database } from '@comprobify/db';
import { z } from 'zod';
import { DomainError, requireFeature, requirePermission, type ActorContext } from '../kernel';
import { correctionInput } from './create-invoice';

// FR-MD-5: saved starting points for an invoice. A template is never a document: it holds
// no number or key, so it changes and goes away freely (inactive, rule 12).

// What the form fills from it: the same rules as an invoice, so a loaded one issues as is.
export const templateContentInput = correctionInput.omit({ clientChanges: true });
export type TemplateContent = z.output<typeof templateContentInput>;

export const saveTemplateInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\n\r\t]*$/),
  content: templateContentInput,
});

export type DocumentTemplate = {
  id: string;
  name: string;
  content: TemplateContent;
  updatedAt: Date;
};

function canUse(ctx: ActorContext) {
  requireFeature(ctx, 'DOCUMENT_TEMPLATES');
  requirePermission(ctx, 'documents.issue');
}

export async function listTemplates(ctx: ActorContext, db: Database): Promise<DocumentTemplate[]> {
  canUse(ctx);
  const rows = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .select()
      .from(schema.documentTemplates)
      .where(
        and(
          eq(schema.documentTemplates.active, true),
          eq(schema.documentTemplates.documentType, '01'),
        ),
      )
      .orderBy(asc(sql`lower(${schema.documentTemplates.name})`)),
  );
  // Read back through the schema: a template saved under older rules still loads.
  return rows.flatMap((row) => {
    const content = templateContentInput.safeParse(row.content);
    return content.success
      ? [{ id: row.id, name: row.name, content: content.data, updatedAt: row.updatedAt }]
      : [];
  });
}

// Saving under a name already used replaces that template, as the old app did.
export async function saveTemplate(
  ctx: ActorContext,
  db: Database,
  raw: z.input<typeof saveTemplateInput>,
): Promise<{ id: string; replaced: boolean }> {
  canUse(ctx);
  const { name, content } = saveTemplateInput.parse(raw);
  const { documentTemplates } = schema;
  return db.withTenant({ tenantId: ctx.tenantId }, async ({ db: tx }) => {
    const sameName = and(
      eq(documentTemplates.active, true),
      eq(documentTemplates.documentType, '01'),
      sql`lower(${documentTemplates.name}) = lower(${name})`,
    );
    const [existing] = await tx
      .select({ id: documentTemplates.id })
      .from(documentTemplates)
      .where(sameName)
      .for('update');
    if (existing) {
      await tx
        .update(documentTemplates)
        .set({ name, content, updatedAt: sql`now()` })
        .where(eq(documentTemplates.id, existing.id));
      return { id: existing.id, replaced: true };
    }
    const [created] = await tx
      .insert(documentTemplates)
      .values({ tenantId: ctx.tenantId, name, content, createdBy: ctx.userId ?? null })
      .returning({ id: documentTemplates.id });
    return { id: created!.id, replaced: false };
  });
}

export async function removeTemplate(ctx: ActorContext, db: Database, id: string): Promise<void> {
  canUse(ctx);
  const templateId = z.uuid().parse(id);
  const [row] = await db.withTenant({ tenantId: ctx.tenantId }, ({ db: tx }) =>
    tx
      .update(schema.documentTemplates)
      .set({ active: false, updatedAt: sql`now()` })
      .where(
        and(eq(schema.documentTemplates.id, templateId), eq(schema.documentTemplates.active, true)),
      )
      .returning({ id: schema.documentTemplates.id }),
  );
  if (!row) throw new DomainError('NOT_FOUND', 'Template not found');
}
