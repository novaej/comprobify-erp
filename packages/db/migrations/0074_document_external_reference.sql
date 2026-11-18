-- NFR-ARCH-3: the caller's own reference on a document, searchable within the company.
ALTER TABLE "documents" ADD COLUMN "external_reference" text;--> statement-breakpoint
CREATE INDEX "documents_external_reference_idx" ON "documents" USING btree ("tenant_id","external_reference") WHERE external_reference IS NOT NULL;