import type { FastifyPluginAsync } from 'fastify';
import { requiereRol, requiereSesion } from '../../plugins/auth.js';
import {
  actualizarMedicamento,
  crearMedicamento,
  darDeBaja,
  eliminarMedicamento,
  listarAdmin,
  listarPublicos,
  reactivar,
} from './medicamentos.service.js';
import type { DatosMedicamento } from './medicamentos.service.js';

const medicamentoBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'codigo',
    'principioActivo',
    'descriptor',
    'formaFarmaceutica',
    'presentacion',
    'proveedor',
    'clasificacionTerapeutica',
    'precio',
    'stock',
    'requiereReceta',
  ],
  properties: {
    codigo: { type: 'string', minLength: 1, maxLength: 20 },
    principioActivo: { type: 'string', minLength: 1, maxLength: 200 },
    descriptor: { type: 'string', minLength: 1, maxLength: 200 },
    formaFarmaceutica: { type: 'string', minLength: 1, maxLength: 100 },
    presentacion: { type: 'string', minLength: 1, maxLength: 100 },
    proveedor: { type: 'string', minLength: 1, maxLength: 100 },
    clasificacionTerapeutica: { type: 'string', minLength: 1, maxLength: 100 },
    precio: { type: 'integer', minimum: 0, maximum: 100000000 },
    stock: { type: 'integer', minimum: 0, maximum: 1000000 },
    requiereReceta: { type: 'boolean' },
  },
} as const;

const actualizarBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    precio: { type: 'integer', minimum: 0, maximum: 100000000 },
    stock: { type: 'integer', minimum: 0, maximum: 1000000 },
    requiereReceta: { type: 'boolean' },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const medicamentoSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'codigo',
    'principioActivo',
    'descriptor',
    'formaFarmaceutica',
    'presentacion',
    'proveedor',
    'clasificacionTerapeutica',
    'precio',
    'stock',
    'requiereReceta',
  ],
  properties: {
    codigo: { type: 'string' },
    principioActivo: { type: 'string' },
    descriptor: { type: 'string' },
    formaFarmaceutica: { type: 'string' },
    presentacion: { type: 'string' },
    proveedor: { type: 'string' },
    clasificacionTerapeutica: { type: 'string' },
    precio: { type: 'integer' },
    stock: { type: 'integer' },
    requiereReceta: { type: 'boolean' },
  },
} as const;

const listaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['medicamentos'],
  properties: { medicamentos: { type: 'array', items: medicamentoSchema } },
} as const;

export const medicamentosRoutes: FastifyPluginAsync = async (app) => {
  // Catálogo público del vecino (siempre actualizado desde la BD).
  app.get(
    '/api/medicamentos',
    { schema: { response: { 200: listaSchema } } },
    async () => ({ medicamentos: await listarPublicos(app.db) }),
  );

  // Panel de gestión: requiere sesión.
  app.get(
    '/api/admin/medicamentos',
    { preHandler: requiereSesion },
    async () => ({ medicamentos: await listarAdmin(app.db) }),
  );

  app.post<{ Body: DatosMedicamento }>(
    '/api/admin/medicamentos',
    { preHandler: requiereRol('admin'), schema: { body: medicamentoBodySchema } },
    async (request, reply) => {
      const medicamento = await crearMedicamento(app.db, request.body);
      return reply.code(201).send({ medicamento });
    },
  );

  app.patch<{ Body: { precio?: number; stock?: number; requiereReceta?: boolean }; Params: { id: string } }>(
    '/api/admin/medicamentos/:id',
    { preHandler: requiereRol('funcionario'), schema: { body: actualizarBodySchema, params: idParamsSchema } },
    async (request) => ({
      medicamento: await actualizarMedicamento(app.db, request.params.id, request.body),
    }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/medicamentos/:id',
    { preHandler: requiereRol('admin'), schema: { params: idParamsSchema } },
    async (request) => ({ medicamento: await darDeBaja(app.db, request.params.id) }),
  );

  // Borrado definitivo de un medicamento ya dado de baja.
  app.delete<{ Params: { id: string } }>(
    '/api/admin/medicamentos/:id/definitivo',
    { preHandler: requiereRol('admin'), schema: { params: idParamsSchema } },
    async (request, reply) => {
      await eliminarMedicamento(app.db, request.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/medicamentos/:id/reactivar',
    { preHandler: requiereRol('admin'), schema: { params: idParamsSchema } },
    async (request) => ({ medicamento: await reactivar(app.db, request.params.id) }),
  );
};
