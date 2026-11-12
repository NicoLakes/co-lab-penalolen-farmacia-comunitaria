CREATE TYPE "public"."product_sale_condition" AS ENUM('direct_sale', 'simple_prescription', 'retained_prescription', 'retained_prescription_stock_control', 'prescription_cheque', 'not_applicable');--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "requires_prescription";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_description_not_blank";--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sale_condition" "product_sale_condition";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_clp" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_name_not_blank" CHECK ("products"."name" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_price_clp_positive" CHECK ("products"."price_clp" IS NULL OR "products"."price_clp" > 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_publication_requires_commercial_data" CHECK (NOT "products"."is_published" OR ("products"."price_clp" IS NOT NULL AND "products"."sale_condition" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_description_not_blank" CHECK ("products"."description" IS NULL OR "products"."description" ~ '[^[:space:]]');
