import Fastify from 'fastify';
import type { FastifyServerOptions } from 'fastify';
import { databasePlugin } from './plugins/database.js';
import type { DatabasePluginOptions } from './plugins/database.js';
import { authPlugin } from './plugins/auth.js';
import { ErrorHttp } from './errors.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { medicamentosRoutes } from './modules/medicamentos/medicamentos.routes.js';
import { pedidosRoutes } from './modules/pedidos/pedidos.routes.js';
import { recetasRoutes } from './modules/recetas/recetas.routes.js';
import { vecinosRoutes } from './modules/vecinos/vecinos.routes.js';

export type AppDependencies = DatabasePluginOptions;

export function buildApp(
  options: FastifyServerOptions = {},
  dependencies: AppDependencies = {},
) {
  // removeAdditional desactivado: los campos desconocidos deben rechazarse
  // con 400 (nuestros esquemas declaran additionalProperties: false).
  const app = Fastify({
    ...options,
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.register(databasePlugin, dependencies);
  app.register(authPlugin);

  // Los errores de negocio (ErrorHttp) llegan aquí con su código HTTP.
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ErrorHttp) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error instanceof Error && 'validation' in error) {
      return reply.code(400).send({ error: 'Los datos enviados no son válidos.' });
    }
    // Errores 4xx de Fastify (Content-Type no soportado, ruta inexistente, …):
    // conservan su código en vez de quedar como error interno.
    if (error instanceof Error && 'statusCode' in error) {
      const codigo = (error as { statusCode?: unknown }).statusCode;
      if (typeof codigo === 'number' && codigo >= 400 && codigo < 500) {
        const mensaje =
          codigo === 400 ? 'Los datos enviados no son válidos.' : error.message;
        return reply.code(codigo).send({ error: mensaje });
      }
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Error interno del servidor.' });
  });

  app.get('/api/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'string', const: 'ok' } },
        },
      },
    },
  }, async () => ({ status: 'ok' }));

  app.register(authRoutes);
  app.register(vecinosRoutes);
  app.register(medicamentosRoutes);
  app.register(pedidosRoutes);
  app.register(recetasRoutes);

  return app;
}
