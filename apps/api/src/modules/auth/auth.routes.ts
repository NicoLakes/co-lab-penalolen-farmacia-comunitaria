import type { FastifyPluginAsync } from 'fastify';
import {
  COOKIE_SESION,
  cerrarSesion,
  duracionSesionSegundos,
  iniciarSesion,
  usuarioDeToken,
} from './auth.service.js';
import { tokenDeCookie } from '../../plugins/auth.js';

const loginBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 200 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: loginBodySchema } },
    async (request, reply) => {
      const sesion = await iniciarSesion(app.db, request.body.email, request.body.password);
      if (!sesion) {
        return reply.code(401).send({ error: 'Correo o contraseña incorrectos.' });
      }

      reply.header(
        'set-cookie',
        `${COOKIE_SESION}=${encodeURIComponent(sesion.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${duracionSesionSegundos()}`,
      );
      return { usuario: sesion.usuario };
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = tokenDeCookie(request);
    if (token) await cerrarSesion(app.db, token);
    reply.header('set-cookie', `${COOKIE_SESION}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request, reply) => {
    const token = tokenDeCookie(request);
    const usuario = token ? await usuarioDeToken(app.db, token) : null;
    if (!usuario) return reply.code(401).send({ error: 'Debe iniciar sesión para continuar.' });
    return usuario;
  });
};
