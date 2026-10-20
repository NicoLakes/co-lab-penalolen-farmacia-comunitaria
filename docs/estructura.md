# Estructura y convenciones

Esta guía define dónde agregar código nuevo. La estructura usa pnpm Workspaces
y conserva las configuraciones y comandos existentes.

## Base disponible

```text
apps/
  web/
    src/
      features/       # Funcionalidades del negocio
      components/     # Componentes visuales compartidos
      api/            # Acceso HTTP común y comprobación de salud existente
      App.tsx         # Composición de la aplicación
      main.tsx        # Entrada de React
      styles.css
    test/
  api/
    src/
      modules/        # Funcionalidades del negocio
      plugins/        # Integraciones de Fastify
      app.ts          # Construcción de la app y registro de rutas/plugins
      config.ts       # Lectura y validación de configuración
      server.ts       # Arranque y cierre del proceso
    test/
packages/
  database/
    src/
      schema/         # Tablas y relaciones por dominio
      client.ts       # Pool y cliente Drizzle
      config.ts       # Validación de configuración de conexión
      index.ts        # Exports públicos
    migrations/       # Historial SQL y metadatos de Drizzle
    test/
      integration/
infra/
  local/              # Dockerfile y herramientas de desarrollo local
docs/                 # Guías, modelo de datos y decisiones cuando se necesiten
```

Las carpetas base vacías contienen `.gitkeep` para poder conservarlas en Git.
Este archivo no tiene comportamiento: retirarlo al agregar el primer archivo
real en esa carpeta. Los dominios del negocio todavía no están implementados.

En la raíz permanecen el README, los manifiestos del workspace, el único
lockfile, la configuración común de TypeScript/ESLint y Compose de desarrollo.
Cada app o paquete conserva su `package.json`, configuración propia y tests.

## Frontend por funcionalidad

Crear `apps/web/src/features/<dominio>/` al implementar una funcionalidad,
por ejemplo `medicamentos`, `inventario` o `ventas`.

Los componentes, hooks y llamadas HTTP específicos viven dentro de esa
funcionalidad. Por ejemplo, `features/medicamentos/MedicamentosPage.tsx` y
`features/medicamentos/medicamentos.api.ts`. Crear subcarpetas solo si el volumen
de archivos lo justifica.

`components/` contiene elementos visuales utilizados por varias funcionalidades.
`api/` contiene infraestructura HTTP común; las operaciones de cada dominio
permanecen en su feature. Validar respuestas externas antes de usarlas y
representar estados de carga, error y vacío con accesibilidad.

`App.tsx` compone la aplicación. Evitar concentrar allí las reglas de todas las
funcionalidades o trasladarlas a un `utils/` genérico.

## API por módulo

Crear `apps/api/src/modules/<dominio>/` al agregar el comportamiento correspondiente.
Este ejemplo es una convención futura, no una plantilla obligatoria:

```text
modules/medicamentos/
  medicamentos.routes.ts      # Rutas HTTP, autorización y coordinación
  medicamentos.schemas.ts     # Validación de requests y respuestas públicas
  medicamentos.service.ts     # Reglas de negocio y casos de uso
  medicamentos.repository.ts  # Consultas de persistencia del módulo
```

Crear un archivo solo cuando tenga una responsabilidad real. Una ruta simple
puede comenzar con menos archivos. Mantener reglas de negocio fuera del manejo
HTTP y separar consultas cuando la complejidad lo requiera.

Registrar rutas y plugins desde `app.ts`, conservando la construcción de la app
sin abrir puertos para poder probarla con `inject`. Usar `plugins/` para
integraciones de Fastify, como conexión a base de datos o autenticación, cuando
se implementen. `server.ts` gestiona el ciclo de vida del proceso.

Comprobar autenticación y permisos sobre cada recurso protegido en el backend.
La validación de frontend no reemplaza la validación de entradas en la API.
Definir las respuestas públicas sin exponer columnas internas o errores de
infraestructura.

Los módulos se coordinan mediante funciones explícitas de servicio. Evitar
dependencias circulares y que un módulo importe las rutas de otro. Una operación
que deba ser atómica, como registrar una venta y descontar stock, se coordina
desde un caso de uso con una transacción compartida.

## Base de datos

`packages/database/` es un paquete de servidor. Centraliza conexión, esquema y
migraciones; las reglas de negocio y consultas específicas de cada módulo
permanecen en la API.

Agregar tablas y relaciones por dominio en `src/schema/<dominio>.ts` y
exportarlas desde `src/schema/index.ts`. Mantener un único historial de
migraciones en `migrations/`, incluyendo los metadatos generados.

Generar migraciones con `pnpm db:generate`, revisar su SQL y aplicar con
`pnpm db:migrate` sobre el entorno local. No modificar migraciones ya aplicadas.
Evaluar datos existentes, constraints, concurrencia y compatibilidad antes de
cambiar el esquema. El procedimiento completo está en el
[README de database](../packages/database/README.md).

Agregar seeds solo cuando existan datos iniciales definidos y un comando
explícito para cargarlos. No incluir credenciales reales ni datos personales.

## Contratos y dependencias

La dirección de las dependencias es:

```text
web --HTTP--> api --> @farmacia/database --> PostgreSQL
```

No importar código interno entre apps. Consumir paquetes por sus exports
públicos y declarar dependencias internas con `workspace:*`.

Crear `packages/contracts/` únicamente cuando haya contratos realmente
compartidos entre web y API. Ese paquete podrá contener DTOs y validaciones
compatibles con navegador, sin importar Fastify, acceso PostgreSQL ni secretos.
Los tipos de tablas no son automáticamente contratos HTTP públicos.

Al agregar una app o paquete, revisar dependencias, exports, scripts de
build/test, `.dockerignore`, `infra/local/Dockerfile` y Compose Watch. La
integración Docker actual enumera rutas y manifiestos concretos; pertenecer
al workspace no incorpora automáticamente un paquete nuevo al entorno Docker.

## Nombres, tests y documentación

- Usar nombres de carpetas en minúsculas y `kebab-case` para varias palabras.
  Mantener el mismo nombre de dominio en web, API y esquema cuando corresponda.
- Usar `PascalCase.tsx` para componentes React y nombres descriptivos con el rol
  del archivo cuando ayude, como `medicamentos.service.ts`.
- Mantener tests en `test/` de cada app o paquete, con sufijo `.test.ts`.
  Los scripts unitarios actuales descubren solo `test/*.test.ts`; colocar allí
  los tests nuevos hasta actualizar explícitamente su descubrimiento.
- Los tests reales de PostgreSQL viven en `packages/database/test/integration/`
  y se ejecutan por separado con `pnpm db:test`.
- Revisar el diff y ejecutar las verificaciones relevantes. `pnpm check`
  ejecuta lint, tipos, tests unitarios y build; no verifica la conexión real a DB.
- Actualizar el README si cambian comandos o configuración, y esta guía si
  cambian las convenciones. Mantener instrucciones operativas específicas en
  el README del paquete correspondiente.
- Versionar `.env.example` con ejemplos seguros. Mantener secretos fuera de Git,
  logs y bundles de navegador; las variables `VITE_*` son públicas.

No crear dominios, paquetes compartidos, configuraciones de producción ni
carpetas genéricas por anticipado. Agregarlos junto con su primera necesidad
concreta y su verificación.
