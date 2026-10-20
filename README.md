# Farmacia Comunitaria

Monorepo con pnpm Workspaces, React + Vite y Fastify. Ambas apps utilizan TypeScript estricto y se instalan con un único lockfile.

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

La pantalla inicial incluye un botón para comprobar la conexión con la API. `Ctrl+C` detiene los servicios; `pnpm dev:down` elimina sus contenedores y red, conservando el volumen PostgreSQL.

## Estructura y responsabilidades

```text
apps/
  web/
    src/
      features/      # Funcionalidades del negocio, al implementarlas
      components/    # Componentes visuales compartidos
      api/           # Acceso HTTP y validación de respuestas externas
      App.tsx        # Interfaz inicial
      main.tsx       # Entrada de React
    test/
    vite.config.ts
  api/
    src/
      modules/       # Funcionalidades del negocio, al implementarlas
      plugins/       # Integraciones de Fastify
      app.ts         # Construcción y rutas de Fastify, sin abrir puertos
      config.ts      # Lectura y validación de configuración
      server.ts      # Arranque, logging y cierre del servidor
    test/
packages/
  database/          # PostgreSQL, cliente Drizzle, modelos y migraciones compartidos
infra/local/         # Imagen de desarrollo y comando único de arranque
docs/                # Convenciones de estructura y documentación técnica
compose.development.yaml # Servicios, dependencias, healthchecks y Compose Watch
eslint.config.js     # Reglas comunes y reglas de React
tsconfig.base.json   # Opciones estrictas compartidas
pnpm-workspace.yaml  # Apps y paquetes que pertenecen al workspace
pnpm-lock.yaml       # Versiones reproducibles para todo el monorepo
```

Cada app declara sus dependencias de ejecución. Las herramientas comunes de desarrollo están en la raíz. La web consume la API por HTTP; no importa código interno del backend. `@farmacia/database` centraliza el acceso PostgreSQL para las apps de backend. Los paquetes internos se referencian con `workspace:*`.

Consultar la [guía de estructura y convenciones](docs/estructura.md) antes de agregar funcionalidades, paquetes o modelos. Define las responsabilidades de cada carpeta, los nombres, las dependencias permitidas y la ubicación de los tests. Las carpetas base vacías se conservan con `.gitkeep`; retirar ese archivo cuando tengan contenido real. Los módulos de negocio y paquetes futuros se crean cuando se implementen, siguiendo esa guía.

El workspace autoriza únicamente el script de instalación de `esbuild`, necesario para `tsx`. Los scripts de instalación de otras dependencias requieren revisión explícita de pnpm.

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
| `pnpm start:api` | Ejecuta la API compilada |
| `pnpm preview:web` | Sirve el build web para revisión local |
| `pnpm db:up` | Levanta solo PostgreSQL |
| `pnpm db:down` | Alias de `dev:down`; detiene el entorno conservando los datos |
| `pnpm db:generate` | Genera migraciones en Docker y escribe los archivos en el repositorio |
| `pnpm db:migrate` | Aplica migraciones desde un contenedor independiente |
| `pnpm db:test` | Verifica la conexión PostgreSQL desde dos pools dentro de Docker |
| `pnpm test:dev` | Comprueba la preparación del entorno y la selección de puertos |

Para ejecutar las verificaciones de forma nativa, instalar las dependencias con `pnpm install --frozen-lockfile` y luego ejecutar `pnpm check`. Las imágenes Docker también usan el lockfile en modo frozen.

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

## Base de datos compartida

La conexión, el esquema y las migraciones están en `packages/database`. El esquema está vacío hasta definir los modelos de la farmacia. La API actual continúa funcionando sin una base de datos configurada.

`pnpm dev` ya inicia la base de datos y aplica las migraciones. Para trabajar únicamente con la base:

```sh
pnpm db:up
pnpm db:generate
pnpm db:migrate
```

Ver [configuración, consumo desde otras apps y flujo de migraciones](packages/database/README.md).

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

La API base solo expone una comprobación de salud pública. Antes de agregar recursos privados, incorporar autenticación, autorización y validación de entradas en las rutas correspondientes. Los tests de la API usan `inject` y no requieren abrir puertos.

Referencias: [pnpm Workspaces](https://pnpm.io/workspaces), [proxy de desarrollo de Vite](https://vite.dev/config/server-options#server-proxy) y [tests de Fastify](https://fastify.dev/docs/latest/Guides/Testing/).
