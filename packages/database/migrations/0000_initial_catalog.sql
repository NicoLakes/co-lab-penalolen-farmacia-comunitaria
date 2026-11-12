CREATE TABLE "inventory_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "inventory_locations_code_unique" UNIQUE("code"),
	CONSTRAINT "inventory_locations_code_not_blank" CHECK (length("inventory_locations"."code") > 0 AND "inventory_locations"."code" = btrim("inventory_locations"."code")),
	CONSTRAINT "inventory_locations_name_not_blank" CHECK (length(btrim("inventory_locations"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"observed_on" date NOT NULL,
	"quantity" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	CONSTRAINT "inventory_snapshots_product_location_date_unique" UNIQUE("product_id","location_id","observed_on"),
	CONSTRAINT "inventory_snapshots_quantity_nonnegative" CHECK ("inventory_snapshots"."quantity" >= 0),
	CONSTRAINT "inventory_snapshots_source_sha256_valid" CHECK ("inventory_snapshots"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "inventory_snapshots_source_sheet_not_blank" CHECK (length(btrim("inventory_snapshots"."source_sheet")) > 0),
	CONSTRAINT "inventory_snapshots_source_row_positive" CHECK ("inventory_snapshots"."source_row" > 0)
);
--> statement-breakpoint
CREATE TABLE "monthly_product_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"period" date NOT NULL,
	"source_quantity" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	CONSTRAINT "monthly_product_consumption_product_period_unique" UNIQUE("product_id","period"),
	CONSTRAINT "monthly_product_consumption_period_first_day" CHECK (extract(day from "monthly_product_consumption"."period") = 1),
	CONSTRAINT "monthly_product_consumption_source_sha256_valid" CHECK ("monthly_product_consumption"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "monthly_product_consumption_source_sheet_not_blank" CHECK (length(btrim("monthly_product_consumption"."source_sheet")) > 0),
	CONSTRAINT "monthly_product_consumption_source_row_positive" CHECK ("monthly_product_consumption"."source_row" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"quantity_unit" text NOT NULL,
	"active_ingredient" text,
	"dosage_form" text,
	"presentation" text,
	"supplier_id" uuid,
	"therapeutic_category_id" uuid,
	"requires_prescription" boolean,
	CONSTRAINT "products_code_unique" UNIQUE("code"),
	CONSTRAINT "products_code_not_blank" CHECK (length("products"."code") > 0 AND "products"."code" = btrim("products"."code")),
	CONSTRAINT "products_description_not_blank" CHECK (length(btrim("products"."description")) > 0),
	CONSTRAINT "products_quantity_unit_not_blank" CHECK (length(btrim("products"."quantity_unit")) > 0),
	CONSTRAINT "products_active_ingredient_not_blank" CHECK ("products"."active_ingredient" IS NULL OR length(btrim("products"."active_ingredient")) > 0),
	CONSTRAINT "products_dosage_form_not_blank" CHECK ("products"."dosage_form" IS NULL OR length(btrim("products"."dosage_form")) > 0),
	CONSTRAINT "products_presentation_not_blank" CHECK ("products"."presentation" IS NULL OR length(btrim("products"."presentation")) > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "suppliers_name_not_blank" CHECK (length(btrim("suppliers"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "therapeutic_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "therapeutic_categories_name_not_blank" CHECK (length(btrim("therapeutic_categories"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_product_consumption" ADD CONSTRAINT "monthly_product_consumption_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_therapeutic_category_id_therapeutic_categories_id_fk" FOREIGN KEY ("therapeutic_category_id") REFERENCES "public"."therapeutic_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_locations_name_unique" ON "inventory_locations" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "inventory_snapshots_location_date_idx" ON "inventory_snapshots" USING btree ("location_id","observed_on");--> statement-breakpoint
CREATE INDEX "monthly_product_consumption_period_idx" ON "monthly_product_consumption" USING btree ("period");--> statement-breakpoint
CREATE INDEX "products_supplier_idx" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "products_therapeutic_category_idx" ON "products" USING btree ("therapeutic_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_unique" ON "suppliers" USING btree (lower(btrim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "therapeutic_categories_name_unique" ON "therapeutic_categories" USING btree (lower(btrim("name")));