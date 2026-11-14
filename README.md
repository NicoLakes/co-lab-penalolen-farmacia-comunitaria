# Farmacia Comunitaria · Peñalolén

Portal de la Farmacia Comunitaria de la Municipalidad de Peñalolén: los vecinos
buscan medicamentos por nombre o principio activo, ven precio y disponibilidad,
armen su carrito y solicitan el pedido para retiro presencial o despacho a
domicilio; el funcionario gestiona el catálogo y procesa la cola de pedidos.

Monorepo con pnpm Workspaces, React + Vite y Fastify. Ambas apps utilizan
TypeScript estricto y se instalan con un único lockfile.

## Alcance

Historias de usuario del documento de alcance (prioridad **Must**):

| HU | Historia | Estado |
| --- | --- | --- |
| HU-01 | Buscar medicamentos por nombre o principio activo | ✅ |
| HU-02 | Ver detalle y manipular el carrito | ✅ |
| HU-03 | Registro e inicio de sesión del vecino | ✅ |
| HU-04 | Checkout con retiro o despacho, estado inicial | ✅ |
| HU-05 | Inscripción de medio de pago en Webpay Oneclick | ⏳ postergada |
| HU-06 | Pago del pedido con Webpay Oneclick | ⏳ postergada |
| HU-07 | Consulta pública del estado del pedido | ✅ |
| HU-08 | Modo Simple (interfaz ampliada y guiada) | ✅ |
| HU-09 | Gestión de catálogo y stock por el funcionario | ✅ |
| HU-10 | Cola de pedidos y cambio de estado con historial | ✅ |
| HU-11 | Preparación y despacho de delivery (salida y entrega) | ✅ |

- **HU-05 y HU-06 (Webpay) quedan pendientes** para una integración posterior:
  hoy el pedido se registra sin pasarela de pago.
- HU-12 en adelante (importación Excel, asistente virtual, roles/auditoría,
  identidad institucional, derechos de datos) están fuera de esta entrega;
  HU-18 y HU-19 son *Won't*.

### Receta médica

- El vecino puede adjuntar su receta al crear la cuenta o desde `#/cuenta`
  (PDF, JPG o PNG, máximo 4 MB).
- La receta queda **pendiente** hasta que un funcionario la revisa en la
  pestaña **Recetas** del panel: la previsualiza en línea (con zoom de 50 % a
  200 %) y registra los medicamentos que indica, con la cantidad autorizada.
- Al aceptarla, el vecino solo puede comprar los medicamentos marcados como
  *Requiere Receta Médica* si están cubiertos hasta la cantidad autorizada.
  Los de **Venta directa** se compran sin receta aunque no estén indicados.
- La receta aceptada **vence a los 6 meses** de su revisión. En `#/cuenta` se
  indica cuántos meses y días de vigencia le quedan o desde cuándo está
  vencida; una receta vencida deja de autorizar y de etiquetar medicamentos
  hasta que se suba una nueva.
- El catálogo etiqueta con **"Indicado en tu receta"** los medicamentos con
  unidades autorizadas por una receta aceptada y vigente de la cuenta con
  sesión.
- La API rechaza con **403** cualquier medicamento marcado como
  *Requiere Receta Médica* que no esté cubierto, y los invitados no pueden
  comprarlos sin cuenta.

## Requisitos y arranque

- Node.js 24 o superior (`.nvmrc` fija la línea 24).
- pnpm 11.1.2, fijado en `packageManager`.
- Docker Desktop activo, con Docker Compose 2.32 o superior.

Desde la raíz:

```sh
pnpm dev
```

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:3001/api/health

Un solo comando construye las imágenes, instala las dependencias dentro de Docker y levanta PostgreSQL, las migraciones, la API y la web. No hace falta ejecutar `pnpm install` en el computador para arrancar el entorno Docker.

El primer arranque crea `.env.local` con una contraseña aleatoria y permisos privados. Si existe la configuración anterior en `packages/database/.env`, reutiliza sus credenciales para conservar el acceso al volumen existente. Los siguientes arranques mantienen la configuración y los datos.

Las direcciones anteriores son las preferidas. Si otro proyecto ocupa un puerto, se elige uno libre entre los siguientes 100 y se muestra la dirección efectiva en la terminal. Al volver a ejecutar el comando se conservan los puertos del proyecto que ya esté funcionando.

Compose espera a que PostgreSQL esté listo, aplica las migraciones en un servicio independiente y después inicia API y web. Los cambios de código se sincronizan con los contenedores: Vite recarga la interfaz y Node reinicia la API. Los cambios de dependencias reconstruyen las imágenes.

`Ctrl+C` detiene los servicios; `pnpm dev:down` elimina sus contenedores y red, conservando el volumen PostgreSQL.

### Arranque nativo (sin Docker)

```sh
pnpm install --frozen-lockfile
pnpm db:up        # solo PostgreSQL en Docker
pnpm --filter api seed   # catálogo de ejemplo y usuarios del panel
pnpm dev:api      # terminal 1
pnpm dev:web      # terminal 2
```

## Rutas de la aplicación

La web usa enrutado por hash:

| Ruta | Contenido |
| --- | --- |
| `#/` | Catálogo del vecino: búsqueda, detalle, carrito, Modo Simple y checkout |
| `#/seguimiento` | Consulta pública de un pedido por número y contacto (HU-07) |
| `#/cuenta` | Registro e inicio de sesión del vecino, sus datos y sus pedidos (HU-03) |
| `#/admin` | Panel de funcionarios: catálogo/stock, cola de pedidos y revisión de recetas (HU-09…HU-11) |

El botón de cuenta del encabezado (catálogo y seguimiento) muestra
**"Iniciar sesión"** mientras no haya sesión del vecino y **"Mi cuenta"** en
cuando entra; desde `#/cuenta` se ven los datos de la cuenta y los pedidos
asociados, con opción de cerrar sesión.

### Credenciales del panel (solo desarrollo)

Creadas por el seed:

| Rol | Email | Contraseña |
| --- | --- | --- |
| Administrador | `admin@farmacia.local` | `admin123` |
| Funcionario | `funcionario@farmacia.local` | `funcionario123` |

Se pueden sobreescribir con `SEED_ADMIN_PASSWORD` y `SEED_FUNCIONARIO_PASSWORD`
antes de ejecutar el seed. No usar estas contraseñas fuera de desarrollo.

## Estados del pedido

```text
RECIBIDO → EN_PREPARACION → LISTO_PARA_RETIRO → ENTREGADO   (retiro)
                        ↘ EN_DESPACHO       → ENTREGADO   (delivery)
```

- `CANCELADO` puede salir desde cualquier estado que no sea final.
- El retiro nunca pasa por `EN_DESPACHO` ni el delivery por
  `LISTO_PARA_RETIRO`; la API rechaza transiciones inválidas con **409**.
- Cada cambio queda en `pedido_historial` con responsable, fecha y hora
  (HU-10), y el vecino lo ve en el seguimiento (HU-07).
- La cola del panel se ordena por defecto de **más reciente a más antiguo**
  (y permite invertir el orden) y se filtra por estado.

## API

| Método y ruta | Descripción |
| --- | --- |
| `GET /api/health` | Comprobación de salud pública |
| `GET /api/medicamentos` | Catálogo público (búsqueda y filtros) |
| `POST /api/pedidos` | Crea un pedido desde el checkout |
| `GET /api/pedidos/seguimiento?numero=&contacto=` | Estado e historial públicos (404 si el contacto no coincide) |
| `POST /api/auth/login` · `logout` · `GET /api/auth/me` | Sesión del funcionario (cookie `farmacia_sesion`) |
| `GET /api/admin/medicamentos` · `POST` · `PATCH /:id` · `DELETE /:id` · `POST /:id/reactivar` | Gestión de catálogo y stock (HU-09) |
| `GET /api/admin/pedidos` · `GET /:id` · `PATCH /:id/estado` | Cola, detalle e historial con cambio de estado (HU-10, HU-11) |
| `POST /api/vecinos/registro` · `login` · `logout` · `GET /me` · `PATCH /me` · `GET /pedidos` | Cuenta del vecino, sus datos y sus pedidos (HU-03) |
| `POST /api/vecinos/recetas` · `GET /api/vecinos/recetas` | Subida de la receta y su estado de revisión |
| `GET /api/admin/recetas` · `GET /:id/archivo` · `POST /:id/estado` | Revisión de recetas: archivo, aceptar con medicamentos indicados o rechazar |

La sesión usa cookies `farmacia_sesion` (funcionarios) y `farmacia_vecino`
(vecinos), con hash sha256 en la base de datos, 7 días de vigencia y
`SameSite=Lax`. Toda ruta `/api/admin/*` exige sesión y rol; la validación y
la autorización viven en el backend, no en el navegador.

## Estructura y responsabilidades

```text
apps/
  web/
    src/
      features/      # Catálogo, seguimiento, cuenta, recetas y panel de administración
      components/    # Componentes visuales compartidos (LogoMuni, etc.)
      App.tsx        # Enrutado por hash
      main.tsx       # Entrada de React
      styles.css     # Estilos globales del portal
    test/            # Tests unitarios con el runner de Node
    vite.config.ts
  api/
    src/
      modules/       # auth, medicamentos, pedidos, vecinos y recetas (reglas de negocio)
      plugins/       # Integraciones de Fastify
      app.ts         # Construcción y rutas de Fastify, sin abrir puertos
      config.ts      # Lectura y validación de configuración
      server.ts      # Arranque, logging y cierre del servidor
      seed.ts        # Catálogo de ejemplo y usuarios del panel
    test/
packages/
  database/          # Conexión, schema Drizzle y migraciones compartidos
infra/local/         # Imagen de desarrollo y comando único de arranque
docs/                # Convenciones de estructura y documentación técnica
compose.development.yaml # Servicios, dependencias, healthchecks y Compose Watch
eslint.config.js     # Reglas comunes y reglas de React
tsconfig.base.json   # Opciones estrictas compartidas
pnpm-workspace.yaml  # Apps y paquetes que pertenecen al workspace
pnpm-lock.yaml       # Versiones reproducibles para todo el monorepo
```

Cada app declara sus dependencias de ejecución. Las herramientas comunes de
desarrollo están en la raíz. La web consume la API por HTTP; no importa código
interno del backend. `@farmacia/database` centraliza el acceso PostgreSQL para
las apps de backend. Los paquetes internos se referencian con `workspace:*`.

Consultar la [guía de estructura y convenciones](docs/estructura.md) antes de
agregar funcionalidades, paquetes o modelos.

El workspace autoriza únicamente el script de instalación de `esbuild`,
necesario para `tsx`. Los scripts de instalación de otras dependencias
requieren revisión explícita de pnpm.

## Comandos

| Comando | Acción |
| --- | --- |
| `pnpm dev` | Levanta todo en Docker con recarga automática |
| `pnpm dev:down` | Elimina contenedores y red locales, conservando los datos |
| `pnpm dev:logs` | Sigue los logs de los servicios |
| `pnpm dev:config` | Valida Compose sin imprimir credenciales |
| `pnpm dev:web` / `pnpm dev:api` | Inicia una app de forma nativa, fuera de Docker |
| `pnpm lint` | Comprueba ESLint sin advertencias permitidas |
| `pnpm typecheck` | Comprueba tipos de código, configuración y tests |
| `pnpm test` | Ejecuta tests de apps y paquetes con el runner de Node |
| `pnpm build` | Compila apps y paquetes en sus carpetas `dist/` |
| `pnpm check` | Ejecuta lint, tipos, tests y build |
| `pnpm --filter api seed` | Carga el catálogo de ejemplo y los usuarios del panel |
| `pnpm start:api` | Ejecuta la API compilada |
| `pnpm preview:web` | Sirve el build web para revisión local |
| `pnpm db:up` | Levanta solo PostgreSQL |
| `pnpm db:down` | Alias de `dev:down`; detiene el entorno conservando los datos |
| `pnpm db:generate` | Genera migraciones en Docker y escribe los archivos en el repositorio |
| `pnpm db:migrate` | Aplica migraciones desde un contenedor independiente |
| `pnpm db:test` | Verifica la conexión PostgreSQL desde dos pools dentro de Docker |
| `pnpm test:dev` | Comprueba la preparación del entorno y la selección de puertos |

Para ejecutar las verificaciones de forma nativa, instalar las dependencias con
`pnpm install --frozen-lockfile` y luego ejecutar `pnpm check`. Las imágenes
Docker también usan el lockfile en modo frozen.

## Base de datos compartida

La conexión, el esquema y las migraciones están en `packages/database`. El
esquema define el catálogo (`medicamentos`), los usuarios del panel
(`usuarios`), los pedidos con su historial (`pedidos`, `pedido_historial`) y la
cuenta del vecino (`vecinos`, `vecino_sesiones`) y las recetas médicas con los
medicamentos autorizados (`recetas`, `receta_items`).

`pnpm dev` ya inicia la base de datos y aplica las migraciones. Para trabajar
únicamente con la base:

```sh
pnpm db:up
pnpm db:generate
pnpm db:migrate
```

Ver [configuración, consumo desde otras apps y flujo de migraciones](packages/database/README.md).

## Integración continua

[GitHub Actions](.github/workflows/ci.yml) ejecuta el CI en cada pull request,
push a `main` y ejecución manual. Los tres controles son obligatorios para
considerar válida una ejecución:

- **Quality**: Node de `.nvmrc`, pnpm de `packageManager`, instalación con
  lockfile frozen y caché del almacén; ejecuta `pnpm check` y
  `pnpm audit --prod --audit-level=high`. La auditoría falla ante vulnerabilidades
  altas o críticas de dependencias de producción.
- **Docker integration**: valida Compose, construye las imágenes y levanta
  PostgreSQL 17, migraciones, API y web. Espera sus healthchecks, prueba dos
  pools PostgreSQL y comprueba los puertos HTTP y el proxy web hacia la API.
  Usa el proyecto aislado `farmacia-ci`, credenciales sintéticas y elimina sus
  contenedores y volúmenes al terminar.
- **Secret scan**: Gitleaks revisa todo el historial Git disponible, con salida
  redactada y sin acceso a red durante el análisis. No requiere licencia ni
  secretos de GitHub.

El workflow usa permisos de lectura, acciones fijadas por SHA y Gitleaks fijado
por digest. Cancela ejecuciones anteriores del mismo pull request o rama.
No filtra por rutas: los cambios del workspace siempre verifican el monorepo
completo. No publica imágenes ni despliega la aplicación.

Al subir el proyecto a GitHub, habilitar Actions y configurar las reglas de
protección de `main` para exigir **Quality**, **Docker integration** y
**Secret scan** después de su primera ejecución. El workflow por sí solo no
bloquea merges. No necesita `.env.local` ni credenciales de producción.

## Configuración y despliegue

El entorno Docker usa `.env.local` en la raíz, generado a partir de `.env.example`. No versionar ese archivo ni regenerar su contraseña si ya existe un volumen con datos. Las variables `POSTGRES_*` solo inicializan volúmenes nuevos; cambiar la contraseña del archivo no cambia la almacenada en PostgreSQL.

| Variable Docker | Uso |
| --- | --- |
| `WEB_PORT` / `API_PORT` / `POSTGRES_PORT` | Puertos preferidos del computador; se busca una alternativa si están ocupados |
| `POSTGRES_USER` / `POSTGRES_DB` | Usuario y base locales, por defecto `farmacia` |
| `POSTGRES_PASSWORD` | Secreto local generado automáticamente |

Dentro de Docker, la API escucha en `0.0.0.0:3001`, Vite en `0.0.0.0:5173` y la conexión PostgreSQL usa el nombre de servicio `postgres`. El proxy web apunta a `http://api:3001`. Los puertos del computador se publican únicamente en `127.0.0.1` y son independientes de esos puertos internos.

Para ejecutar apps de forma nativa, pueden utilizarse los `.env.example` de cada app:

| App | Variable | Valor por defecto | Uso |
| --- | --- | --- | --- |
| api | `HOST` | `127.0.0.1` | Interfaz de escucha; usar `0.0.0.0` si el despliegue requiere acceso desde fuera del contenedor |
| api | `PORT` | `3001` | Puerto entero entre 1 y 65535 |
| web | `API_PROXY_TARGET` | `http://127.0.0.1:3001` | Destino del proxy de desarrollo de Vite |

En ejecución nativa, el proceso de la API carga `.env` con Node y Vite carga el de la web. Si se cambia el puerto nativo de la API, actualizar también `API_PROXY_TARGET` en la web. Los archivos `.env`, las dependencias del computador y los certificados privados quedan fuera del contexto de build y de Compose Watch. No colocar secretos en variables `VITE_*`: se incluyen en el código del navegador.

Esta configuración Docker es de desarrollo. En producción, servir `apps/web/dist` mediante un servidor estático y configurar el reverse proxy para que `/api` apunte a la API. El proxy de Vite no forma parte del build ni de `preview:web`. Mantener el mismo origen evita necesitar CORS para esta estructura.

Las rutas de administración validan sesión, rol y entradas en el backend. Los
tests de la API usan `inject` y no requieren abrir puertos.

Referencias: [pnpm Workspaces](https://pnpm.io/workspaces), [proxy de desarrollo de Vite](https://vite.dev/config/server-options#server-proxy) y [tests de Fastify](https://fastify.dev/docs/latest/Guides/Testing/).
