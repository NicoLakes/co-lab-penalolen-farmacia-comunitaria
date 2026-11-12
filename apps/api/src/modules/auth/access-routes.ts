import type { Database } from '@farmacia/database';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { registerOrderRoutes, uuidField } from '../orders/order-routes.js';
import type { Authorize } from '../orders/order-routes.js';
import type { OrderPolicy } from '../orders/order-input.js';
import { activeRoles, findManagedUser, permits, resolveUser, setUserRole, setUserStatus } from './access.js';
import type { Auth } from './auth.js';

const emailField = { type: 'string', format: 'email', maxLength: 254 };
const authActions = [
  {
    path: '/api/auth/email-otp/send-verification-otp',
    body: { type: 'object', required: ['email', 'type'], additionalProperties: false,
      properties: { email: emailField, type: { const: 'sign-in' } } },
  },
  {
    path: '/api/auth/sign-in/email-otp',
    body: { type: 'object', required: ['email', 'otp'], additionalProperties: false,
      properties: { email: emailField, otp: { type: 'string', pattern: '^[0-9]{6}$' } } },
  },
  { path: '/api/auth/sign-out' },
] as const;

function sendChange(reply: FastifyReply, result: 'ok' | 'forbidden' | 'not_found' | 'conflict') {
  if (result === 'ok') return reply.code(204).send();
  const status = { forbidden: 403, not_found: 404, conflict: 409 }[result];
  return reply.code(status).send({ code: result });
}

export function registerAccessRoutes(app: FastifyInstance, options: {
  db: Database; auth: Auth; origin: string; orderPolicy?: OrderPolicy | undefined;
}) {
  const { db, auth, origin, orderPolicy } = options;
  app.register(async (api) => {
    api.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.origin !== origin) {
        return reply.code(403).send({ code: 'origin_not_allowed' });
      }
    });
    api.setErrorHandler((error, request, reply) => {
      if (typeof error === 'object' && error !== null && 'statusCode' in error
        && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
        return reply.code(error.statusCode).send({ code: 'invalid_request' });
      }
      request.log.error('Access or order request failed');
      return reply.code(500).send({ code: 'internal_error' });
    });

    for (const action of authActions) {
      api.post(action.path, {
        bodyLimit: 4_096, ...('body' in action && { schema: { body: action.body } }),
      }, async (request, reply) => {
        const headers = fromNodeHeaders(request.headers);
        headers.set('x-farmacia-client-ip', request.ip);
        headers.set('content-type', 'application/json');
        headers.delete('content-length');
        const response = await auth.handler(new Request(new URL(action.path, origin), {
          method: 'POST', headers, body: JSON.stringify(request.body ?? {}),
        }));
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header('Set-Cookie', cookies);
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) reply.header('Retry-After', retryAfter);
        await response.body?.cancel();
        if (response.ok) return { ok: true };
        const code = response.status === 429 ? 'rate_limited' : response.status >= 500 ? 'auth_unavailable' : 'auth_rejected';
        return reply.code(response.status).send({ code });
      });
    }

    const authorize: Authorize = async (request, reply, permission) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session?.user.emailVerified) {
        reply.code(401).send({ code: 'authentication_required' });
        return;
      }
      const user = await resolveUser(db, session.user.id);
      if (user.status !== 'active') {
        reply.code(403).send({ code: 'account_disabled' });
        return;
      }
      const roles = (await activeRoles(db, user.id)).map(({ role }) => role);
      if (permission && !permits(roles, permission)) {
        reply.code(403).send({ code: 'forbidden' });
        return;
      }
      return { id: user.id, email: session.user.email, roles };
    };

    api.get('/api/me', async (request, reply) => await authorize(request, reply) ?? reply);
    api.post<{ Body: { email: string } }>('/api/admin/users/lookup', {
      schema: { body: { type: 'object', required: ['email'], properties: { email: emailField } } },
    }, async (request, reply) => {
      const admin = await authorize(request, reply, 'users.manage_access');
      if (!admin) return reply;
      const user = await findManagedUser(db, request.body.email);
      return user ?? reply.code(404).send({ code: 'not_found' });
    });

    const userIdParams = { type: 'object', required: ['userId'], properties: { userId: uuidField } };
    api.patch<{ Params: { userId: string }; Body: { status: 'active' | 'disabled' } }>('/api/admin/users/:userId/status', {
      schema: { params: userIdParams,
        body: { type: 'object', required: ['status'], properties: { status: { enum: ['active', 'disabled'] } } } },
    }, async (request, reply) => {
      const admin = await authorize(request, reply, 'users.manage_access');
      if (!admin) return reply;
      return sendChange(reply, await setUserStatus(db, request.params.userId.toLowerCase(), request.body.status, admin.id));
    });

    for (const method of ['PUT', 'DELETE'] as const) {
      api.route<{ Params: { userId: string; role: 'buyer' | 'pharmacy_operator' } }>({
        method, url: '/api/admin/users/:userId/roles/:role',
        schema: { params: { type: 'object', required: ['userId', 'role'],
          properties: { userId: uuidField, role: { enum: ['buyer', 'pharmacy_operator'] } } } },
        async handler(request, reply) {
          const admin = await authorize(request, reply, 'users.manage_access');
          if (!admin) return reply;
          const { userId, role } = request.params;
          return sendChange(reply, await setUserRole(db, userId.toLowerCase(), role, method === 'PUT', admin.id));
        },
      });
    }
    registerOrderRoutes(api, db, authorize, orderPolicy);
  });
}
