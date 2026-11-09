-- FR-SAL-8, ADR-020: a credit note that brings its goods back to stock.
ALTER TABLE "documents" ADD COLUMN "returns_stock" boolean DEFAULT false NOT NULL;
