-- A document can come from another: a credit note from its invoice, a guía from one (FR-SAL-8,
-- FR-SAL-9). The foreign key is checked with a query on a table under forced RLS (mistake 20).
SELECT set_config('app.rls_system', 'on', true);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "related_document_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_related_fk" FOREIGN KEY ("tenant_id","related_document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_related_idx" ON "documents" USING btree ("tenant_id","related_document_id") WHERE related_document_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_related_check" CHECK (related_document_id IS DISTINCT FROM id
        AND (document_type <> '01' OR related_document_id IS NULL)
        AND (document_type <> '04' OR related_document_id IS NOT NULL));--> statement-breakpoint
-- The link is part of "number and origin": it never changes. Same function as 0028 with it added.
CREATE OR REPLACE FUNCTION public.app_document_immutability_check() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.tenant_id, NEW.issue_point_id, NEW.document_type, NEW.series, NEW.sequential,
      NEW.ambiente, NEW.created_by, NEW.created_at, NEW.idempotency_key, NEW.payload_hash,
      NEW.related_document_id)
     IS DISTINCT FROM
     (OLD.tenant_id, OLD.issue_point_id, OLD.document_type, OLD.series, OLD.sequential,
      OLD.ambiente, OLD.created_by, OLD.created_at, OLD.idempotency_key, OLD.payload_hash,
      OLD.related_document_id) THEN
    RAISE EXCEPTION 'A document''s number and origin never change' USING ERRCODE = '23514';
  END IF;
  IF (OLD.authorization_number IS NOT NULL AND NEW.authorization_number IS DISTINCT FROM OLD.authorization_number)
     OR (OLD.authorized_at IS NOT NULL AND NEW.authorized_at IS DISTINCT FROM OLD.authorized_at)
     OR (OLD.authorization_xml IS NOT NULL AND NEW.authorization_xml IS DISTINCT FROM OLD.authorization_xml) THEN
    RAISE EXCEPTION 'An authorization is set once' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.status = 'SIGNED' AND OLD.status <> 'SIGNED')
     AND (NEW.access_key, NEW.issue_date, NEW.signed_xml, NEW.revision, NEW.client_id,
          NEW.buyer_id_type, NEW.buyer_identification, NEW.buyer_name, NEW.buyer_address,
          NEW.buyer_email, NEW.subtotal, NEW.discount, NEW.tax_totals, NEW.total)
         IS DISTINCT FROM
         (OLD.access_key, OLD.issue_date, OLD.signed_xml, OLD.revision, OLD.client_id,
          OLD.buyer_id_type, OLD.buyer_identification, OLD.buyer_name, OLD.buyer_address,
          OLD.buyer_email, OLD.subtotal, OLD.discount, OLD.tax_totals, OLD.total) THEN
    RAISE EXCEPTION 'A document''s content changes only when it goes back to SIGNED'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
SELECT set_config('app.rls_system', '', true);
