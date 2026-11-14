import type { FastifyPluginAsync } from 'fastify';
import { tokenDeCookie } from '../../plugins/auth.js';
import { listarPedidosVecino } from '../pedidos/pedidos.service.js';
import {
  COOKIE_VECINO,
  actualizarVecino,
  cerrarSesionVecino,
  duracionSesionVecinoSegundos,
  iniciarSesionVecino,
  registrarVecino,
  vecinoDeToken,
} from './vecinos.service.js';
import type { DatosActualizacion, DatosRegistro } from './vecinos.service.js';

const registroBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'email', 'telefono', 'direccion', 'password'],
  properties: {
    nombre: { type: 'string', minLength: 2, maxLength: 120 },
    email: { type: 'string', minLength: 5, maxLength: 200, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
    telefono: { type: 'string', minLength: 8, maxLength: 20 },
    direccion: { type: 'string', minLength: 5, maxLength: 200 },
    password: { type: 'string', minLength: 6, maxLength: 200 },
  },
} as const;

// Edición de los datos de la cuenta desde "Mi cuenta" (al menos un campo).
const actualizacionBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    nombre: { type: 'string', minLength: 2, maxLength: 120 },
    email: { type: 'string', minLength: 5, maxLength: 200, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
    telefono: { type: 'string', minLength: 8, maxLength: 20 },
    direccion: { type: 'string', minLength: 5, maxLength: 200 },
  },
} as const;

const loginBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 200 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

// Cuenta del vecino (HU-03): registro, sesión y sus pedidos asociados.
export const vecinosRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: DatosRegistro }>(
    '/api/vecinos/registro',
    { schema: { body: registroBodySchema } },
    async (request, reply) => {
      const sesion = await registrarVecino(app.db, request.body);
      reply.header(
        'set-cookie',
        `${COOKIE_VECINO}=${encodeURIComponent(sesion.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${duracionSesionVecinoSegundos()}`,
      );
      return reply.code(201).send({ vecino: sesion.vecino });
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/vecinos/login',
    { schema: { body: loginBodySchema } },
    async (request, reply) => {
      const sesion = await iniciarSesionVecino(app.db, request.body.email, request.body.password);
      if (!sesion) {
        return reply.code(401).send({ error: 'Correo o contraseña incorrectos.' });
      }
      reply.header(
        'set-cookie',
        `${COOKIE_VECINO}=${encodeURIComponent(sesion.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${duracionSesionVecinoSegundos()}`,
      );
      return { vecino: sesion.vecino };
    },
  );

  app.post('/api/vecinos/logout', async (request, reply) => {
    const token = tokenDeCookie(request, COOKIE_VECINO);
    if (token) await cerrarSesionVecino(app.db, token);
    reply.header('set-cookie', `${COOKIE_VECINO}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return reply.code(204).send();
  });

  app.get('/api/vecinos/me', async (request, reply) => {
    const token = tokenDeCookie(request, COOKIE_VECINO);
    const vecino = token ? await vecinoDeToken(app.db, token) : null;
    if (!vecino) return reply.code(401).send({ error: 'Debe iniciar sesión para continuar.' });
    return vecino;
  });

  // Edición de los datos de la cuenta (nombre, correo, teléfono y dirección).
  app.patch<{ Body: DatosActualizacion }>(
    '/api/vecinos/me',
    { schema: { body: actualizacionBodySchema } },
    async (request, reply) => {
      const token = tokenDeCookie(request, COOKIE_VECINO);
      const vecino = token ? await vecinoDeToken(app.db, token) : null;
      if (!vecino) return reply.code(401).send({ error: 'Debe iniciar sesión para continuar.' });
      const actualizado = await actualizarVecino(app.db, vecino.id, request.body);
      return { vecino: actualizado };
    },
  );

  // Pedidos asociados a la cuenta del vecino (HU-03).
  app.get('/api/vecinos/pedidos', async (request, reply) => {
    const token = tokenDeCookie(request, COOKIE_VECINO);
    const vecino = token ? await vecinoDeToken(app.db, token) : null;
    if (!vecino) return reply.code(401).send({ error: 'Debe iniciar sesión para continuar.' });
    return { pedidos: await listarPedidosVecino(app.db, vecino.id) };
  });
};
