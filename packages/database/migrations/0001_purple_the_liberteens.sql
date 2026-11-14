CREATE TABLE "vecino_sesiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"vecino_id" uuid NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	CONSTRAINT "vecino_sesiones_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "vecinos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"password_hash" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vecinos_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "pedidos" ADD COLUMN "vecino_id" uuid;--> statement-breakpoint
ALTER TABLE "vecino_sesiones" ADD CONSTRAINT "vecino_sesiones_vecino_id_vecinos_id_fk" FOREIGN KEY ("vecino_id") REFERENCES "public"."vecinos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_vecino_id_vecinos_id_fk" FOREIGN KEY ("vecino_id") REFERENCES "public"."vecinos"("id") ON DELETE set null ON UPDATE no action;