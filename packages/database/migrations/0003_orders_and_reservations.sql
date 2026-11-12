CREATE TYPE "public"."fulfillment_method" AS ENUM('pickup', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'confirmed', 'fulfilled', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."stock_reservation_status" AS ENUM('active', 'released', 'consumed');--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_code_snapshot" text NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"quantity_unit_snapshot" text NOT NULL,
	"sale_condition_snapshot" "product_sale_condition" NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_clp" integer NOT NULL,
	"line_total_clp" bigint GENERATED ALWAYS AS (unit_price_clp::bigint * quantity) STORED NOT NULL,
	CONSTRAINT "order_items_order_product_unique" UNIQUE("order_id","product_id"),
	CONSTRAINT "order_items_id_product_unique" UNIQUE("id","product_id"),
	CONSTRAINT "order_items_amounts_valid" CHECK ("order_items"."quantity" > 0 AND "order_items"."unit_price_clp" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"reason" text NOT NULL,
	"actor_reference" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_events_operation_unique" UNIQUE("order_id","operation_id"),
	CONSTRAINT "order_status_events_actor_reason_valid" CHECK ("order_status_events"."actor_reference" ~ '[^[:space:]]' AND "order_status_events"."reason" ~ '[^[:space:]]'),
	CONSTRAINT "order_status_events_transition_valid" CHECK (CASE
    WHEN "order_status_events"."from_status" IS NULL THEN "order_status_events"."to_status" = 'pending_payment'
    WHEN "order_status_events"."from_status" = 'pending_payment' THEN "order_status_events"."to_status" IN ('confirmed', 'cancelled', 'expired')
    WHEN "order_status_events"."from_status" = 'confirmed' THEN "order_status_events"."to_status" = 'fulfilled'
    ELSE false END)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text DEFAULT 'FC-' || nextval('order_number_seq') NOT NULL,
	"buyer_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"fulfillment_method" "fulfillment_method" NOT NULL,
	"delivery_details_snapshot" jsonb,
	"subtotal_clp" bigint NOT NULL,
	"delivery_fee_clp" integer DEFAULT 0 NOT NULL,
	"total_clp" bigint GENERATED ALWAYS AS (subtotal_clp + delivery_fee_clp) STORED NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_buyer_idempotency_unique" UNIQUE("buyer_id","idempotency_key"),
	CONSTRAINT "orders_amounts_valid" CHECK ("orders"."subtotal_clp" > 0 AND "orders"."delivery_fee_clp" >= 0),
	CONSTRAINT "orders_deadline_valid" CHECK (isfinite("orders"."reservation_expires_at") AND "orders"."reservation_expires_at" > "orders"."created_at"),
	CONSTRAINT "orders_fulfillment_details_valid" CHECK ((
    "orders"."fulfillment_method" = 'pickup' AND "orders"."delivery_details_snapshot" IS NULL AND "orders"."delivery_fee_clp" = 0
  ) OR (
    "orders"."fulfillment_method" = 'delivery' AND "orders"."delivery_details_snapshot" IS NOT NULL
    AND jsonb_typeof("orders"."delivery_details_snapshot") = 'object'
  ))
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "stock_reservation_status" DEFAULT 'active' NOT NULL,
	"consumed_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "stock_reservations_consumed_movement_id_unique" UNIQUE("consumed_movement_id"),
	CONSTRAINT "stock_reservations_item_balance_unique" UNIQUE("order_item_id","balance_id"),
	CONSTRAINT "stock_reservations_quantity_positive" CHECK ("stock_reservations"."quantity" > 0),
	CONSTRAINT "stock_reservations_closure_valid" CHECK (
    ("stock_reservations"."status" = 'active') = ("stock_reservations"."closed_at" IS NULL)
    AND ("stock_reservations"."status" = 'consumed') = ("stock_reservations"."consumed_movement_id" IS NOT NULL)
    AND ("stock_reservations"."closed_at" IS NULL OR "stock_reservations"."closed_at" >= "stock_reservations"."created_at")
  )
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_issuer" text NOT NULL,
	"identity_subject" text NOT NULL,
	CONSTRAINT "users_identity_unique" UNIQUE("identity_issuer","identity_subject"),
	CONSTRAINT "users_identity_not_blank" CHECK ("users"."identity_issuer" ~ '[^[:space:]]' AND "users"."identity_subject" ~ '[^[:space:]]')
);
--> statement-breakpoint
ALTER TABLE "inventory_balances" DROP CONSTRAINT "inventory_balances_reservations_not_enabled";--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_id_product_unique" UNIQUE("id","product_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_id_balance_unique" UNIQUE("id","balance_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_item_product_fk" FOREIGN KEY ("order_item_id","product_id") REFERENCES "public"."order_items"("id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_balance_product_fk" FOREIGN KEY ("balance_id","product_id") REFERENCES "public"."inventory_balances"("id","product_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_movement_balance_fk" FOREIGN KEY ("consumed_movement_id","balance_id") REFERENCES "public"."inventory_movements"("id","balance_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_pending_deadline_idx" ON "orders" USING btree ("reservation_expires_at","id") WHERE "orders"."status" = 'pending_payment';--> statement-breakpoint
CREATE INDEX "stock_reservations_balance_status_idx" ON "stock_reservations" USING btree ("balance_id","status");--> statement-breakpoint
-- Compare the final counter and allocations after both sides have been written.
CREATE FUNCTION "public".check_reservation_counter() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE balance uuid;
BEGIN
  IF TG_TABLE_NAME = 'stock_reservations' THEN
    balance := NEW.balance_id;
  ELSE
    balance := NEW.id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "public".inventory_balances b WHERE b.id = balance
    AND b.reserved_quantity <> (
      SELECT coalesce(sum(r.quantity), 0) FROM "public".stock_reservations r
      WHERE r.balance_id = b.id AND r.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'Reserved quantity must equal active allocations' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER inventory_reservation_counter_guard
  AFTER INSERT OR UPDATE OF reserved_quantity ON "inventory_balances"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public".check_reservation_counter();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER reservation_counter_guard
  AFTER INSERT OR UPDATE ON "stock_reservations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public".check_reservation_counter();
--> statement-breakpoint
CREATE FUNCTION "public".protect_order_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Order history cannot be rewritten' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_items_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "order_items"
  FOR EACH STATEMENT EXECUTE FUNCTION "public".protect_order_history();
--> statement-breakpoint
CREATE TRIGGER order_status_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON "order_status_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "public".protect_order_history();
--> statement-breakpoint
CREATE TRIGGER stock_reservations_retain_history BEFORE DELETE OR TRUNCATE ON "stock_reservations"
  FOR EACH STATEMENT EXECUTE FUNCTION "public".protect_order_history();
--> statement-breakpoint
CREATE FUNCTION "public".guard_order_details() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_order uuid;
DECLARE parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'stock_reservations' THEN
    SELECT order_id INTO parent_order FROM "public".order_items WHERE id = NEW.order_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reservation order item does not exist' USING ERRCODE = '23503';
    END IF;
  ELSE
    parent_order := NEW.order_id;
  END IF;

  SELECT status::text INTO parent_status FROM "public".orders WHERE id = parent_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order does not exist' USING ERRCODE = '23503';
  END IF;
  IF TG_TABLE_NAME = 'order_status_events' THEN
    IF NEW.to_status::text <> parent_status OR EXISTS (
      SELECT 1 FROM "public".order_status_events WHERE order_id = parent_order AND to_status = NEW.to_status
    ) THEN
      RAISE EXCEPTION 'Order status event must record a new transition' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF parent_status <> 'pending_payment' OR EXISTS (
      SELECT 1 FROM "public".order_status_events WHERE order_id = parent_order
    ) THEN
      RAISE EXCEPTION 'Order allocations and items are fixed at creation' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'stock_reservations' THEN
      IF NEW.status <> 'active' THEN
        RAISE EXCEPTION 'Reservations must start active' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    IF (NEW.id, NEW.order_item_id, NEW.product_id, NEW.balance_id, NEW.quantity, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.order_item_id, OLD.product_id, OLD.balance_id, OLD.quantity, OLD.created_at)
      OR OLD.status <> 'active' OR NOT (
        (NEW.status = 'released' AND parent_status IN ('expired', 'cancelled'))
        OR (NEW.status = 'consumed' AND parent_status = 'fulfilled')
      ) THEN
      RAISE EXCEPTION 'Invalid reservation transition' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'consumed' AND NOT EXISTS (
      SELECT 1 FROM "public".inventory_movements m
      WHERE m.id = NEW.consumed_movement_id AND m.balance_id = NEW.balance_id
        AND m.movement_type = 'sale' AND m.quantity_delta = -NEW.quantity
    ) THEN
      RAISE EXCEPTION 'Consumed reservation requires a matching sale movement' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_items_creation_guard BEFORE INSERT ON "order_items"
  FOR EACH ROW EXECUTE FUNCTION "public".guard_order_details();
--> statement-breakpoint
CREATE TRIGGER order_status_events_transition_guard BEFORE INSERT ON "order_status_events"
  FOR EACH ROW EXECUTE FUNCTION "public".guard_order_details();
--> statement-breakpoint
CREATE TRIGGER stock_reservations_transition_guard BEFORE INSERT OR UPDATE ON "stock_reservations"
  FOR EACH ROW EXECUTE FUNCTION "public".guard_order_details();
--> statement-breakpoint
CREATE FUNCTION "public".check_order_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_status text;
DECLARE expected_allocation text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - ARRAY['status', 'updated_at'] <> to_jsonb(OLD) - ARRAY['status', 'updated_at'] THEN
      RAISE EXCEPTION 'Order purchase details cannot change' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = NEW.status THEN
      RETURN NULL;
    END IF;
    previous_status := OLD.status::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "public".order_status_events e WHERE e.order_id = NEW.id
      AND e.to_status = NEW.status AND e.from_status::text IS NOT DISTINCT FROM previous_status
  ) THEN
    RAISE EXCEPTION 'Order transition requires a matching audit event' USING ERRCODE = '23514';
  END IF;

  SELECT CASE status
    WHEN 'fulfilled' THEN 'consumed'
    WHEN 'cancelled' THEN 'released'
    WHEN 'expired' THEN 'released'
    ELSE 'active' END INTO expected_allocation
  FROM "public".orders WHERE id = NEW.id;

  IF NEW.subtotal_clp IS DISTINCT FROM (
    SELECT sum(i.line_total_clp) FROM "public".order_items i WHERE i.order_id = NEW.id
  ) OR EXISTS (
    SELECT 1 FROM "public".order_items i
    LEFT JOIN "public".stock_reservations r ON r.order_item_id = i.id
    WHERE i.order_id = NEW.id GROUP BY i.id
    HAVING coalesce(sum(r.quantity), 0) <> i.quantity
      OR count(*) FILTER (WHERE r.status::text <> expected_allocation) > 0
  ) THEN
    RAISE EXCEPTION 'Order totals and allocations must match its items' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER order_consistency_guard AFTER INSERT OR UPDATE ON "orders"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public".check_order_consistency();
