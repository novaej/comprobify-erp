-- A credit note's line says which invoice line it credits (FR-SAL-8). No foreign key: the origin's
-- lines never change once it is authorized, and the balance reads them by position.
ALTER TABLE "document_lines" ADD COLUMN "source_position" integer;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_source_position_check" CHECK (source_position IS NULL OR source_position >= 1);