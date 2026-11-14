import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { COOKIE_SESION, usuarioDeToken } from '../modules/auth/auth.service.js';
import type { Rol, UsuarioSesion } from '../modules/auth/auth.service.js';
import { ErrorHttp } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    usuario: UsuarioSesion | null;
  }
}

export const authPlugin: FastifyPluginAsync = fp(async (app) => {
  app.decorateRequest('usuario', null);
});

// Lee el token de una cookie por nombre (sin dependencias externas).
export function tokenDeCookie(request: FastifyRequest, nombre = COOKIE_SESION): string | null {
  const cookie = request.headers.cookie;
  if (!cookie) return null;
  for (const par of cookie.split(';')) {
    const [clave, ...valor] = par.trim().split('=');
    if (clave === nombre && valor.length > 0) return decodeURIComponent(valor.join('='));
  }
  return null;
}

// Resuelve el usuario de la cookie o lanza 401.
async function asegurarSesion(request: FastifyRequest): Promise<UsuarioSesion> {
  const token = tokenDeCookie(request);
  const usuario = token ? await usuarioDeToken(request.server.db, token) : null;
  if (!usuario) throw new ErrorHttp(401, 'Debe iniciar sesión para continuar.');
  request.usuario = usuario;
  return usuario;
}

// Guardia compartida: exige sesión válida y adjunta request.usuario.
export const requiereSesion: preHandlerHookHandler = async (request) => {
  await asegurarSesion(request);
};

// Guardia de rol: admin también cumple permisos de funcionario.
export function requiereRol(rolMinimo: Rol): preHandlerHookHandler {
  return async (request) => {
    const usuario = await asegurarSesion(request);
    const esAdmin = usuario.rol === 'admin';
    const cumple = rolMinimo === 'admin' ? esAdmin : esAdmin || usuario.rol === 'funcionario';
    if (!cumple) throw new ErrorHttp(403, 'Su rol no tiene permisos para esta operación.');
  };
}
