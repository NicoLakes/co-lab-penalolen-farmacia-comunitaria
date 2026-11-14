import type { FastifyPluginAsync } from 'fastify';
import { ESTADOS_PEDIDO } from '@farmacia/database/schema';
import type { EstadoPedido } from '@farmacia/database/schema';
import { requiereRol, requiereSesion, tokenDeCookie } from '../../plugins/auth.js';
import { usuarioDeToken } from '../auth/auth.service.js';
import { COOKIE_VECINO, vecinoDeToken } from '../vecinos/vecinos.service.js';
import {
  cambiarEstadoPedido,
  crearPedido,
  listarPedidos,
  obtenerPedido,
  seguirPedido,
} from './pedidos.service.js';
import type { SolicitudPedido } from './pedidos.service.js';

const solicitudSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clienteNombre', 'contacto', 'modalidad', 'items'],
  properties: {
    clienteNombre: { type: 'string', minLength: 2, maxLength: 120 },
    contacto: { type: 'string', minLength: 3, maxLength: 160 },
    modalidad: { type: 'string', enum: ['RETIRO', 'DELIVERY'] },
    direccion: { type: 'string', minLength: 5, maxLength: 200 },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['codigo', 'cantidad'],
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
  properties: { estado: { type: 'string', enum: [...ESTADOS_PEDIDO] } },
} as const;

const estadoBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['estado'],
  properties: { estado: { type: 'string', enum: [...ESTADOS_PEDIDO] } },
} as const;

// Consulta pública de estado (HU-07): número + contacto del solicitante.
const seguimientoQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['numero', 'contacto'],
  properties: {
    numero: { type: 'integer', minimum: 1 },
    contacto: { type: 'string', minLength: 3, maxLength: 160 },
  },
} as const;

export const pedidosRoutes: FastifyPluginAsync = async (app) => {
  // Checkout mínimo: invitar o con cuenta del vecino; la sesión se asocia al pedido (HU-03).
  app.post<{ Body: SolicitudPedido }>(
    '/api/pedidos',
    { schema: { body: solicitudSchema } },
    async (request, reply) => {
      const token = tokenDeCookie(request);
      const usuario = token ? await usuarioDeToken(app.db, token) : null;
      const responsable = usuario?.nombre ?? request.body.clienteNombre.trim();

      const tokenVecino = tokenDeCookie(request, COOKIE_VECINO);
      const vecino = tokenVecino ? await vecinoDeToken(app.db, tokenVecino) : null;

      const pedido = await crearPedido(app.db, request.body, responsable, vecino?.id ?? null);
      return reply.code(201).send({ pedido });
    },
  );

  // Estado del pedido para el vecino sin cuenta (HU-07).
  app.get<{ Querystring: { numero: number; contacto: string } }>(
    '/api/pedidos/seguimiento',
    { schema: { querystring: seguimientoQuerySchema } },
    async (request) => ({
      pedido: await seguirPedido(app.db, request.query.numero, request.query.contacto),
    }),
  );

  // Cola de pedidos del panel (HU-10).
  app.get<{ Querystring: { estado?: EstadoPedido } }>(
    '/api/admin/pedidos',
    { preHandler: requiereSesion, schema: { querystring: estadoQuerySchema } },
    async (request) => ({
      pedidos: await listarPedidos(app.db, request.query.estado),
      estados: [...ESTADOS_PEDIDO],
    }),
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/pedidos/:id',
    { preHandler: requiereSesion, schema: { params: idParamsSchema } },
    async (request) => ({ pedido: await obtenerPedido(app.db, request.params.id) }),
  );

  // Cambio de estado con historial; responsabilidad del funcionario/admin (HU-11).
  app.patch<{ Params: { id: string }; Body: { estado: EstadoPedido } }>(
    '/api/admin/pedidos/:id/estado',
    {
      preHandler: requiereRol('funcionario'),
      schema: { params: idParamsSchema, body: estadoBodySchema },
    },
    async (request) => {
      const responsable = request.usuario?.nombre ?? 'Desconocido';
      const pedido = await cambiarEstadoPedido(
        app.db,
        request.params.id,
        request.body.estado,
        responsable,
      );
      return { pedido };
    },
  );
};
