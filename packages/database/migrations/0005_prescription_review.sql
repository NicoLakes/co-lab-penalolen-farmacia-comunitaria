CREATE TYPE "public"."prescription_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
DROP INDEX "orders_pending_deadline_idx";--> statement-breakpoint
ALTER TABLE "order_status_events" DROP CONSTRAINT "order_status_events_transition_valid";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_deadline_valid";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."order_status_v2" AS ENUM('pending_review', 'pending_payment', 'confirmed', 'fulfilled', 'cancelled', 'expired', 'rejected');--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."order_status_v2" USING "status"::text::"public"."order_status_v2";--> statement-breakpoint
ALTER TABLE "order_status_events" ALTER COLUMN "from_status" TYPE "public"."order_status_v2" USING "from_status"::text::"public"."order_status_v2";--> statement-breakpoint
ALTER TABLE "order_status_events" ALTER COLUMN "to_status" TYPE "public"."order_status_v2" USING "to_status"::text::"public"."order_status_v2";--> statement-breakpoint
DROP TYPE "public"."order_status";--> statement-breakpoint
ALTER TYPE "public"."order_status_v2" RENAME TO "order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending_payment';--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" DROP NOT NULL;--> statement-breakpoint
CREATE TABLE "order_prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"status" "prescription_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_prescriptions_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "order_prescriptions_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "order_prescriptions_storage_key_valid" CHECK ("order_prescriptions"."storage_key" ~ '^[a-z0-9][a-z0-9._-]{0,199}$' AND "order_prescriptions"."storage_key" NOT LIKE '%..%'),
	CONSTRAINT "order_prescriptions_file_valid" CHECK ("order_prescriptions"."file_name" ~ '[^[:space:]]'
    AND "order_prescriptions"."mime_type" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    AND "order_prescriptions"."file_size_bytes" > 0 AND "order_prescriptions"."file_size_bytes" <= 5242880
    AND "order_prescriptions"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_prescriptions_review_valid" CHECK ((
    "order_prescriptions"."status" = 'pending' AND "order_prescriptions"."reviewed_by_user_id" IS NULL AND "order_prescriptions"."reviewed_at" IS NULL AND "order_prescriptions"."rejection_reason" IS NULL
  ) OR (
    "order_prescriptions"."status" = 'approved' AND "order_prescriptions"."reviewed_by_user_id" IS NOT NULL AND "order_prescriptions"."reviewed_at" IS NOT NULL
    AND "order_prescriptions"."reviewed_at" >= "order_prescriptions"."created_at" AND "order_prescriptions"."rejection_reason" IS NULL
  ) OR (
    "order_prescriptions"."status" = 'rejected' AND "order_prescriptions"."reviewed_by_user_id" IS NOT NULL AND "order_prescriptions"."reviewed_at" IS NOT NULL
    AND "order_prescriptions"."reviewed_at" >= "order_prescriptions"."created_at" AND "order_prescriptions"."rejection_reason" IS NOT NULL AND "order_prescriptions"."rejection_reason" ~ '[^[:space:]]'
  ))
);
--> statement-breakpoint
ALTER TABLE "order_prescriptions" ADD CONSTRAINT "order_prescriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_prescriptions" ADD CONSTRAINT "order_prescriptions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_prescriptions" ADD CONSTRAINT "order_prescriptions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_prescriptions_status_created_idx" ON "order_prescriptions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_pending_deadline_idx" ON "orders" USING btree ("reservation_expires_at","id") WHERE "orders"."status" = 'pending_payment';--> statement-breakpoint
CREATE INDEX "orders_pending_review_idx" ON "orders" USING btree ("created_at","id") WHERE "orders"."status" = 'pending_review';--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_transition_valid" CHECK (CASE
    WHEN "order_status_events"."from_status" IS NULL THEN "order_status_events"."to_status" IN ('pending_review', 'pending_payment')
    WHEN "order_status_events"."from_status" = 'pending_review' THEN "order_status_events"."to_status" IN ('pending_payment', 'rejected', 'cancelled')
    WHEN "order_status_events"."from_status" = 'pending_payment' THEN "order_status_events"."to_status" IN ('confirmed', 'cancelled', 'expired')
    WHEN "order_status_events"."from_status" = 'confirmed' THEN "order_status_events"."to_status" = 'fulfilled'
    ELSE false END);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_deadline_valid" CHECK ((
    ("orders"."status" IN ('pending_review', 'rejected') AND "orders"."reservation_expires_at" IS NULL)
    OR ("orders"."status" IN ('pending_payment', 'confirmed', 'fulfilled', 'expired')
      AND "orders"."reservation_expires_at" IS NOT NULL
      AND isfinite("orders"."reservation_expires_at")
      AND "orders"."reservation_expires_at" > "orders"."created_at")
    OR ("orders"."status" = 'cancelled'
      AND ("orders"."reservation_expires_at" IS NULL
        OR (isfinite("orders"."reservation_expires_at") AND "orders"."reservation_expires_at" > "orders"."created_at")))
  ));--> statement-breakpoint
CREATE TRIGGER order_prescriptions_retain_history BEFORE DELETE OR TRUNCATE ON "order_prescriptions"
  FOR EACH STATEMENT EXECUTE FUNCTION "public".protect_order_history();--> statement-breakpoint
CREATE FUNCTION "public".guard_order_prescription() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  SELECT status::text INTO parent_status FROM "public".orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order does not exist' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF parent_status <> 'pending_review' OR NEW.status <> 'pending' OR EXISTS (
      SELECT 1 FROM "public".order_status_events WHERE order_id = NEW.order_id
    ) THEN
      RAISE EXCEPTION 'Prescriptions must be attached when creating a pending_review order' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (NEW.id, NEW.order_id, NEW.uploaded_by_user_id, NEW.storage_key, NEW.file_name, NEW.mime_type, NEW.file_size_bytes, NEW.file_sha256, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.order_id, OLD.uploaded_by_user_id, OLD.storage_key, OLD.file_name, OLD.mime_type, OLD.file_size_bytes, OLD.file_sha256, OLD.created_at)
      OR OLD.status <> 'pending' OR NOT (
        (NEW.status = 'approved' AND parent_status = 'pending_payment')
        OR (NEW.status = 'rejected' AND parent_status = 'rejected')
      ) THEN
      RAISE EXCEPTION 'Invalid prescription review transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER order_prescriptions_transition_guard BEFORE INSERT OR UPDATE ON "order_prescriptions"
  FOR EACH ROW EXECUTE FUNCTION "public".guard_order_prescription();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public".guard_order_details() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF parent_status NOT IN ('pending_review', 'pending_payment') OR EXISTS (
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
        (NEW.status = 'released' AND parent_status IN ('expired', 'cancelled', 'rejected'))
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
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public".check_order_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_status text;
DECLARE expected_allocation text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - ARRAY['status', 'updated_at', 'reservation_expires_at']
      <> to_jsonb(OLD) - ARRAY['status', 'updated_at', 'reservation_expires_at']
      OR (
        NEW.reservation_expires_at IS DISTINCT FROM OLD.reservation_expires_at
        AND NOT (OLD.status = 'pending_review' AND NEW.status = 'pending_payment' AND OLD.reservation_expires_at IS NULL)
      ) THEN
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

  IF NEW.status = 'pending_review' AND NOT EXISTS (
    SELECT 1 FROM "public".order_prescriptions p WHERE p.order_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Prescription review orders require a prescription attachment' USING ERRCODE = '23514';
  END IF;

  IF previous_status = 'pending_review' AND NEW.status = 'pending_payment' AND NOT EXISTS (
    SELECT 1 FROM "public".order_prescriptions p WHERE p.order_id = NEW.id AND p.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Approving a prescription order requires an approved prescription record' USING ERRCODE = '23514';
  END IF;

  IF previous_status = 'pending_review' AND NEW.status = 'rejected' AND NOT EXISTS (
    SELECT 1 FROM "public".order_prescriptions p WHERE p.order_id = NEW.id AND p.status = 'rejected'
  ) THEN
    RAISE EXCEPTION 'Rejecting a prescription order requires a rejected prescription record' USING ERRCODE = '23514';
  END IF;

  SELECT CASE status
    WHEN 'fulfilled' THEN 'consumed'
    WHEN 'cancelled' THEN 'released'
    WHEN 'expired' THEN 'released'
    WHEN 'rejected' THEN 'released'
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
