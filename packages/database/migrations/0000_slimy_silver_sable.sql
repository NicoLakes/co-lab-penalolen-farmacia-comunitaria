CREATE TABLE "medicamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"principio_activo" text NOT NULL,
	"descriptor" text NOT NULL,
	"forma_farmaceutica" text NOT NULL,
	"presentacion" text NOT NULL,
	"proveedor" text NOT NULL,
	"clasificacion_terapeutica" text NOT NULL,
	"precio" integer NOT NULL,
	"stock" integer NOT NULL,
	"requiere_receta" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medicamentos_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "medicamentos_precio_positivo" CHECK ("medicamentos"."precio" >= 0),
	CONSTRAINT "medicamentos_stock_no_negativo" CHECK ("medicamentos"."stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	CONSTRAINT "sesiones_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"password_hash" text NOT NULL,
	"rol" text DEFAULT 'funcionario' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email"),
	CONSTRAINT "usuarios_rol_valido" CHECK ("usuarios"."rol" in ('admin', 'funcionario'))
);
--> statement-breakpoint
CREATE TABLE "pedido_historial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pedido_id" uuid NOT NULL,
	"estado" text NOT NULL,
	"responsable" text NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pedido_historial_estado_valido" CHECK ("pedido_historial"."estado" in ('RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_RETIRO', 'EN_DESPACHO', 'ENTREGADO', 'CANCELADO'))
);
--> statement-breakpoint
CREATE TABLE "pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" serial NOT NULL,
	"cliente_nombre" text NOT NULL,
	"contacto" text NOT NULL,
	"modalidad" text NOT NULL,
	"direccion" text,
	"estado" text DEFAULT 'RECIBIDO' NOT NULL,
	"items" jsonb NOT NULL,
	"total" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pedidos_modalidad_valida" CHECK ("pedidos"."modalidad" in ('RETIRO', 'DELIVERY')),
	CONSTRAINT "pedidos_estado_valido" CHECK ("pedidos"."estado" in ('RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_RETIRO', 'EN_DESPACHO', 'ENTREGADO', 'CANCELADO')),
	CONSTRAINT "pedidos_total_no_negativo" CHECK ("pedidos"."total" >= 0),
	CONSTRAINT "pedidos_direccion_requerida_en_delivery" CHECK (("pedidos"."modalidad" = 'DELIVERY' AND "pedidos"."direccion" IS NOT NULL) OR "pedidos"."modalidad" = 'RETIRO')
);
--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_historial" ADD CONSTRAINT "pedido_historial_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE cascade ON UPDATE no action;