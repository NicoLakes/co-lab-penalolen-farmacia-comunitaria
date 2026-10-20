# @farmacia/database

Paquete de servidor para compartir PostgreSQL y Drizzle entre las apps del monorepo. Importarlo no abre conexiones ni exige variables de entorno; cada proceso crea su propio pool cuando lo necesita.

Seguir la [guía de estructura del repositorio](../../docs/estructura.md). Este paquete centraliza conexión, tablas, relaciones y migraciones; las reglas de negocio, permisos y consultas específicas de cada módulo corresponden a la API. Los contratos HTTP compartidos se incorporarán en un paquete independiente solo cuando sean necesarios.

```text
src/
  schema/index.ts    # Esquema vacío; exportar aquí los futuros modelos por dominio
  config.ts         # Validación de la URL sin incluir credenciales en errores
  client.ts         # Creación de Drizzle y pool PostgreSQL
  index.ts          # API pública
migrations/         # Historial generado por Drizzle Kit
drizzle.config.ts   # PostgreSQL, ruta del esquema y ruta de migraciones
../../compose.development.yaml # PostgreSQL 17 y el resto de los servicios locales
```

## Configuración local

Desde la raíz del monorepo, un solo comando prepara la configuración y levanta todos los servicios:

```sh
pnpm dev
```

Se genera `.env.local` en la raíz con una contraseña aleatoria y permisos `0600`. El comando compone la URL interna de PostgreSQL y la entrega únicamente a la API y al servicio de migraciones. No hace falta configurar una URL en el navegador. Si ya existe `packages/database/.env`, se reutilizan sus variables `POSTGRES_*` al crear la configuración raíz; los archivos existentes nunca se sobrescriben.

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Para conectar o migrar de forma nativa | URL `postgresql://` o `postgres://` con host y base de datos; se construye automáticamente dentro de Docker |
| `POSTGRES_PASSWORD` | Docker; generada automáticamente | Contraseña de inicialización de PostgreSQL en `.env.local` raíz |
| `POSTGRES_USER` | No | Usuario local; por defecto `farmacia` |
| `POSTGRES_DB` | No | Base local; por defecto `farmacia` |
| `POSTGRES_PORT` | No | Puerto local; por defecto `5432` |

```sh
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:down
```

`db:up` espera a que PostgreSQL esté listo. El puerto se publica solo en `127.0.0.1`; si está ocupado, se selecciona uno libre. `db:down` es un alias de `dev:down` y elimina los contenedores de todo el entorno conservando el volumen `farmacia-comunitaria_postgres_data`. No usar `down -v` si se quieren preservar los datos. Las variables `POSTGRES_*` inicializan únicamente volúmenes nuevos: cambiar la contraseña de `.env.local` no cambia la de un volumen existente.

`db:generate` ejecuta Drizzle Kit dentro de Docker, monta el esquema como solo lectura y guarda las migraciones generadas en la carpeta del repositorio. `db:migrate` ejecuta un contenedor independiente que espera a que PostgreSQL esté listo. El arranque completo también ejecuta ese servicio antes de iniciar la API. Las migraciones no se ejecutan con cada cambio de código.

## Consumir desde una app de backend

Agregar `"@farmacia/database": "workspace:*"` a sus dependencias y ejecutar `pnpm install`. Compilar el paquete con `pnpm --filter @farmacia/database build` antes de arrancar la app en desarrollo; `pnpm build` respeta el orden de dependencias del workspace.

Ejemplo para una app Fastify:

```ts
import { createDatabase } from '@farmacia/database';

const { db, pool } = createDatabase({
  onPoolError: (error) => app.log.error({ err: error }, 'Error del pool PostgreSQL'),
});

app.addHook('onClose', async () => { await pool.end(); });
```

Docker entrega `DATABASE_URL` a la API automáticamente. Fuera de Docker, la app debe cargar su propia `DATABASE_URL`, por ejemplo en `apps/api/.env`, o pasarla explícitamente como `connectionString`. El paquete no carga archivos `.env` al importarse.

Para una base externa o comandos nativos, copiar `packages/database/.env.example` a `.env` en esa carpeta y configurar la URL. Los comandos `pnpm --filter @farmacia/database db:generate` y `pnpm --filter @farmacia/database db:migrate` cargan ese archivo sin reemplazar variables definidas en el entorno. Los comandos raíz `pnpm db:*` operan sobre el entorno Docker local.

Crear una instancia por proceso y reutilizar `db`. El pool admite hasta 10 conexiones por instancia, espera hasta 5 segundos al conectar y libera conexiones inactivas después de 30 segundos. Multiplicar esos límites por el número de procesos para dimensionar PostgreSQL. `onPoolError` es obligatorio para que la app gestione los errores de conexiones inactivas. Cerrar el pool al detener cada app.

El paquete exporta `createDatabase`, los tipos `Database` y `DatabaseOptions`, y el esquema como `schema` o mediante `@farmacia/database/schema`. Sus exports bloquean el uso en bundles de navegador. La web accede a los datos mediante una API y comparte DTOs cuando sea necesario.

## Modelos y migraciones

1. Crear archivos por dominio dentro de `src/schema/` y exportar sus tablas y relaciones desde `src/schema/index.ts`.
2. Ejecutar `pnpm db:generate` desde la raíz. Generar migraciones no necesita conexión ni `DATABASE_URL`.
3. Revisar el SQL y versionar toda la carpeta `migrations`, incluidos sus metadatos.
4. Ejecutar `pnpm db:migrate` contra el entorno correspondiente.

El esquema inicial no contiene tablas. No se agrega una migración de dominio ficticia. Drizzle inicializa su historial y no genera SQL si no detecta cambios.

Las apps comparten un único historial de migraciones. Aplicarlo una sola vez mediante un job de despliegue, antes de arrancar versiones que dependan del nuevo esquema; no migrar automáticamente al iniciar cada app. No modificar migraciones ya aplicadas. Para cambios de esquema que afecten datos existentes, diseñar y revisar la transición antes del despliegue.

## Producción

Configurar `DATABASE_URL` mediante el gestor de secretos del entorno. Para conexiones remotas, usar TLS con verificación de certificado, por ejemplo `sslmode=verify-full`, y la CA requerida por el proveedor. El cliente conserva los parámetros TLS de la URL.

El servicio Compose es para desarrollo local. Su usuario inicial tiene permisos de administración; en producción, usar credenciales de migración separadas y usuarios de aplicación con solo los permisos necesarios. No incluir `DATABASE_URL` en variables `VITE_*`, respuestas HTTP ni logs.

## Verificación

`pnpm check` incluye los tests unitarios, tipos y build del paquete sin necesitar PostgreSQL. Para comprobar la conexión real desde dos pools independientes, configurar `DATABASE_URL`, levantar PostgreSQL y ejecutar:

```sh
pnpm --filter @farmacia/database test:integration
```

La prueba de integración solo consulta la base de datos; no crea tablas ni modifica datos. Para ejecutarla completamente en Docker, usar `pnpm db:test` desde la raíz. El workspace fija una versión corregida de `esbuild` para la dependencia transitiva antigua que trae Drizzle Kit (GHSA-67mh-4wv8-2f99).

Referencias: [PostgreSQL en Drizzle](https://orm.drizzle.team/docs/get-started-postgresql), [migraciones](https://orm.drizzle.team/docs/migrations), [pool de pg](https://node-postgres.com/apis/pool).
