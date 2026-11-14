import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const LONGITUD_CLAVE = 64;
const OPCIONES = { N: 16384, r: 8, p: 1 };

// scrypt con callback; se envuelve para poder usar async/await con tipado exacto.
function derivar(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, LONGITUD_CLAVE, OPCIONES, (error, clave) => {
      if (error) reject(error);
      else resolve(clave);
    });
  });
}

// Contraseña guardada como "scrypt:salt:hash" para no tenerla en claro.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const clave = await derivar(password, salt);
  return `scrypt:${salt.toString('hex')}:${clave.toString('hex')}`;
}

export async function verifyPassword(password: string, almacenada: string): Promise<boolean> {
  const [esquema, saltHex, hashHex] = almacenada.split(':');
  if (esquema !== 'scrypt' || !saltHex || !hashHex) return false;

  const clave = await derivar(password, Buffer.from(saltHex, 'hex'));
  const esperada = Buffer.from(hashHex, 'hex');
  return clave.length === esperada.length && timingSafeEqual(clave, esperada);
}
