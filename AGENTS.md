# Convenciones del repositorio

Antes de modificar el proyecto, leer el [README](README.md) y la
[guía de estructura](docs/estructura.md). Para persistencia, leer también
[`packages/database/README.md`](packages/database/README.md).

- Mantener las aplicaciones en `apps/`, los paquetes internos en `packages/` y
  las herramientas del entorno en `infra/`.
- Organizar funcionalidades de web en `apps/web/src/features/<dominio>/` y de
  API en `apps/api/src/modules/<dominio>/`. Crear solo los archivos necesarios.
- Reservar `apps/web/src/components/` para componentes visuales compartidos y
  `apps/api/src/plugins/` para integraciones de Fastify.
- La web consume la API por HTTP. No importar código interno de otra app ni
  acceso a base de datos desde el navegador.
- Mantener conexión, tablas y migraciones en `packages/database/`; las reglas
  del negocio y los permisos corresponden a los módulos de la API.
- Declarar dependencias internas con `workspace:*` y consumir sus exports
  públicos. Al agregar un paquete, revisar su integración con Docker.
- Conservar los tests en `test/` de cada app o paquete y comprobar que los
  scripts realmente descubran los tests agregados.
- No crear módulos, paquetes compartidos, seeds ni capas vacías por anticipado.
  Retirar `.gitkeep` cuando una carpeta ya tenga archivos reales.
- No versionar secretos ni modificar migraciones ya aplicadas. Validar entradas
  y autorización en el backend para cada recurso protegido.
- Revisar el diff y ejecutar las comprobaciones relevantes antes de finalizar.
  `pnpm check` ejecuta lint, tipos, tests y build; `pnpm db:test` comprueba la
  conexión real con PostgreSQL y requiere Docker.
