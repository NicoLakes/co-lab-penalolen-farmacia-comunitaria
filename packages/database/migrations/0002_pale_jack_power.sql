CREATE TABLE "receta_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receta_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"cantidad" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "receta_items_cantidad_positiva" CHECK ("receta_items"."cantidad" > 0)
);
--> statement-breakpoint
CREATE TABLE "recetas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vecino_id" uuid NOT NULL,
	"archivo_nombre" text NOT NULL,
	"archivo_tipo" text NOT NULL,
	"archivo_datos" text NOT NULL,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"observaciones" text,
	"revisado_por" text,
	"revisado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recetas_estado_valido" CHECK ("recetas"."estado" in ('PENDIENTE', 'ACEPTADA', 'RECHAZADA'))
);
--> statement-breakpoint
ALTER TABLE "vecinos" ADD COLUMN "telefono" text;--> statement-breakpoint
ALTER TABLE "vecinos" ADD COLUMN "direccion" text;--> statement-breakpoint
ALTER TABLE "receta_items" ADD CONSTRAINT "receta_items_receta_id_recetas_id_fk" FOREIGN KEY ("receta_id") REFERENCES "public"."recetas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_vecino_id_vecinos_id_fk" FOREIGN KEY ("vecino_id") REFERENCES "public"."vecinos"("id") ON DELETE cascade ON UPDATE no action;