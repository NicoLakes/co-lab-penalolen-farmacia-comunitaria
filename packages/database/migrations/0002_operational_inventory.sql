CREATE TYPE "public"."inventory_movement_type" AS ENUM('opening', 'receipt', 'sale', 'adjustment', 'transfer_out', 'transfer_in');--> statement-breakpoint
CREATE TYPE "public"."inventory_tracking" AS ENUM('quantity_only', 'lot_and_expiration');--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"lot_id" uuid,
	"on_hand_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_product_location_lot_unique" UNIQUE NULLS NOT DISTINCT("product_id","location_id","lot_id"),
	CONSTRAINT "inventory_balances_on_hand_nonnegative" CHECK ("inventory_balances"."on_hand_quantity" >= 0),
	CONSTRAINT "inventory_balances_reserved_valid" CHECK ("inventory_balances"."reserved_quantity" >= 0 AND "inventory_balances"."reserved_quantity" <= "inventory_balances"."on_hand_quantity"),
	CONSTRAINT "inventory_balances_reservations_not_enabled" CHECK ("inventory_balances"."reserved_quantity" = 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"expires_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_lots_product_number_unique" UNIQUE("product_id","lot_number"),
	CONSTRAINT "inventory_lots_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "inventory_lots_number_valid" CHECK ("inventory_lots"."lot_number" ~ '[^[:space:]]' AND "inventory_lots"."lot_number" = btrim("inventory_lots"."lot_number")),
	CONSTRAINT "inventory_lots_expiration_finite" CHECK (isfinite("inventory_lots"."expires_on"))
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"balance_id" uuid NOT NULL,
	"movement_type" "inventory_movement_type" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"actor_reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_operation_balance_unique" UNIQUE("operation_id","balance_id"),
	CONSTRAINT "inventory_movements_delta_nonzero" CHECK ("inventory_movements"."quantity_delta" <> 0),
	CONSTRAINT "inventory_movements_delta_sign" CHECK ((
    "inventory_movements"."movement_type" IN ('opening', 'receipt', 'transfer_in') AND "inventory_movements"."quantity_delta" > 0
  ) OR (
    "inventory_movements"."movement_type" IN ('sale', 'transfer_out') AND "inventory_movements"."quantity_delta" < 0
  ) OR "inventory_movements"."movement_type" = 'adjustment'),
	CONSTRAINT "inventory_movements_reason_not_blank" CHECK ("inventory_movements"."reason" ~ '[^[:space:]]'),
	CONSTRAINT "inventory_movements_actor_not_blank" CHECK ("inventory_movements"."actor_reference" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "inventory_locations" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "inventory_tracking" "inventory_tracking";--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_lot_product_fk" FOREIGN KEY ("lot_id","product_id") REFERENCES "public"."inventory_lots"("id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_balance_id_inventory_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."inventory_balances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_balances_location_idx" ON "inventory_balances" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_lot_product_idx" ON "inventory_balances" USING btree ("lot_id","product_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_balance_created_idx" ON "inventory_movements" USING btree ("balance_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_opening_unique" ON "inventory_movements" USING btree ("balance_id") WHERE "inventory_movements"."movement_type" = 'opening';
--> statement-breakpoint
-- Cross-table invariants require triggers; Drizzle cannot express them as checks.
CREATE FUNCTION "public".check_inventory_tracking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tracking text;
BEGIN
  -- Serialize stock creation with changes to the product's counting policy.
  SELECT inventory_tracking::text INTO tracking FROM "public".products
    WHERE id = NEW.product_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory product does not exist' USING ERRCODE = '23503';
  END IF;
  IF tracking IS NULL THEN
    RAISE EXCEPTION 'Inventory tracking must be assigned first' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'inventory_lots' THEN
    IF tracking <> 'lot_and_expiration' THEN
      RAISE EXCEPTION 'This product does not track lots' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND
      (NEW.id, NEW.product_id, NEW.lot_number, NEW.expires_on) IS DISTINCT FROM
      (OLD.id, OLD.product_id, OLD.lot_number, OLD.expires_on) AND
      EXISTS (SELECT 1 FROM "public".inventory_balances WHERE lot_id = OLD.id) THEN
      RAISE EXCEPTION 'A referenced lot cannot be redefined' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (tracking = 'lot_and_expiration') <> (NEW.lot_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Balance lot does not match product tracking' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND
      (NEW.id, NEW.product_id, NEW.location_id, NEW.lot_id) IS DISTINCT FROM
      (OLD.id, OLD.product_id, OLD.location_id, OLD.lot_id) THEN
      RAISE EXCEPTION 'Balance identity cannot change; use a transfer' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_lots_tracking_guard BEFORE INSERT OR UPDATE ON "inventory_lots"
  FOR EACH ROW EXECUTE FUNCTION "public".check_inventory_tracking();
--> statement-breakpoint
CREATE TRIGGER inventory_balances_tracking_guard BEFORE INSERT OR UPDATE ON "inventory_balances"
  FOR EACH ROW EXECUTE FUNCTION "public".check_inventory_tracking();
--> statement-breakpoint
CREATE FUNCTION "public".protect_inventory_product_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.inventory_tracking, NEW.quantity_unit) IS DISTINCT FROM
    (OLD.inventory_tracking, OLD.quantity_unit) AND (
      EXISTS (SELECT 1 FROM "public".inventory_balances WHERE product_id = OLD.id) OR
      EXISTS (SELECT 1 FROM "public".inventory_lots WHERE product_id = OLD.id)
    ) THEN
    RAISE EXCEPTION 'Tracking and quantity unit cannot change after inventory exists'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_inventory_policy_guard BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION "public".protect_inventory_product_policy();
--> statement-breakpoint
CREATE FUNCTION "public".protect_inventory_movement_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movements are append-only; record a compensating movement'
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_movements_history_guard BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "public".protect_inventory_movement_history();
--> statement-breakpoint
CREATE TRIGGER inventory_movements_truncate_guard BEFORE TRUNCATE ON "inventory_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "public".protect_inventory_movement_history();
