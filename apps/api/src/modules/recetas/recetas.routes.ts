import type { FastifyPluginAsync } from 'fastify';
import { ESTADOS_RECETA } from '@farmacia/database/schema';
import type { EstadoReceta } from '@farmacia/database/schema';
import { requiereRol, requiereSesion, tokenDeCookie } from '../../plugins/auth.js';
import { COOKIE_VECINO, vecinoDeToken } from '../vecinos/vecinos.service.js';
import {
  archivoReceta,
  evaluarReceta,
  listarRecetasAdmin,
  listarRecetasVecino,
  subirReceta,
} from './recetas.service.js';
import type { ArchivoReceta } from './recetas.service.js';

const archivoBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'tipo', 'datos'],
  properties: {
    nombre: { type: 'string', minLength: 1, maxLength: 120 },
    tipo: { type: 'string', enum: ['application/pdf', 'image/jpeg', 'image/png'] },
    // 4 MB en base64 + margen; el límite real se valida en el servicio.
    datos: { type: 'string', minLength: 8, maxLength: 6000000 },
  },
} as const;

const evaluacionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['estado'],
  properties: {
    estado: { type: 'string', enum: ['ACEPTADA', 'RECHAZADA'] },
    observaciones: { type: 'string', maxLength: 500 },
    items: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo'],
        properties: {
          codigo: { type: 'string', minLength: 1, maxLength: 20 },
          cantidad: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const estadoQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { estado: { type: 'string', enum: [...ESTADOS_RECETA] } },
} as const;

// Recetas médicas: el vecino las sube y el funcionario las revisa.
export const recetasRoutes: FastifyPluginAsync = async (app) => {
  async function vecinoDePeticion(request: Parameters<typeof tokenDeCookie>[0]) {
    const token = tokenDeCookie(request, COOKIE_VECINO);
    return token ? vecinoDeToken(app.db, token) : null;
  }

  // Subida desde la cuenta del vecino (archivo en base64).
  app.post<{ Body: ArchivoReceta }>(
    '/api/vecinos/recetas',
    { schema: { body: archivoBodySchema }, bodyLimit: 8 * 1024 * 1024 },
    async (request, reply) => {
      const vecino = await vecinoDePeticion(request);
      if (!vecino) return reply.code(401).send({ error: 'Debe iniciar sesión para adjuntar la receta.' });
      const receta = await subirReceta(app.db, vecino.id, request.body);
      return reply.code(201).send({ receta });
    },
  );

  // Recetas propias con su estado de revisión.
  app.get('/api/vecinos/recetas', async (request, reply) => {
    const vecino = await vecinoDePeticion(request);
    if (!vecino) return reply.code(401).send({ error: 'Debe iniciar sesión para continuar.' });
    return { recetas: await listarRecetasVecino(app.db, vecino.id) };
  });

  // Cola de revisión del panel (pendientes por defecto).
  app.get<{ Querystring: { estado?: EstadoReceta } }>(
    '/api/admin/recetas',
    { preHandler: requiereSesion, schema: { querystring: estadoQuerySchema } },
    async (request) => ({
      recetas: await listarRecetasAdmin(app.db, request.query.estado),
      estados: [...ESTADOS_RECETA],
    }),
  );

  // Archivo original para revisarlo antes de aceptar o rechazar.
  app.get<{ Params: { id: string } }>(
    '/api/admin/recetas/:id/archivo',
    { preHandler: requiereSesion, schema: { params: idParamsSchema } },
    async (request, reply) => {
      const archivo = await archivoReceta(app.db, request.params.id);
      return reply
        .header('content-type', archivo.tipo)
        .header(
          'content-disposition',
          `inline; filename="${encodeURIComponent(archivo.nombre)}"`,
        )
        .send(Buffer.from(archivo.datos, 'base64'));
    },
  );

  // Aceptar (con los medicamentos que indica la receta) o rechazar.
  app.post<{ Params: { id: string }; Body: { estado: 'ACEPTADA' | 'RECHAZADA'; observaciones?: string; items?: { codigo: string; cantidad?: number }[] } }>(
    '/api/admin/recetas/:id/estado',
    {
      preHandler: requiereRol('funcionario'),
      schema: { params: idParamsSchema, body: evaluacionBodySchema },
    },
    async (request) => {
      const responsable = request.usuario?.nombre ?? 'Desconocido';
      const receta = await evaluarReceta(app.db, request.params.id, request.body, responsable);
      return { receta };
    },
  );
};
