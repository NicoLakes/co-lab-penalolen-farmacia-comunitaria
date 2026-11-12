import { maxInteger, orderUuid } from '../orders/order-input.js';

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.BETTER_AUTH_SECRET;
  const baseUrl = env.BETTER_AUTH_URL;
  const host = env.SMTP_HOST;
  const from = env.SMTP_FROM;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  const rawLocations = env.ORDER_LOCATION_IDS;
  const rawDuration = env.ORDER_RESERVATION_SECONDS;
  const rawFee = env.ORDER_DELIVERY_FEE_CLP;
  if (![secret, baseUrl, host, from, user, pass, env.SMTP_PORT, rawLocations, rawDuration, rawFee].some(Boolean)) return;

  if (!secret || secret.length < 32 || !host || !from || /[\r\n]/.test(from) || Boolean(user) !== Boolean(pass)) {
    throw new Error('Set BETTER_AUTH_SECRET, SMTP_HOST and SMTP_FROM. SMTP credentials must be configured together.');
  }
  const url = URL.parse(baseUrl ?? '');
  const loopback = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BETTER_AUTH_URL must be the public HTTPS origin or a local loopback HTTP origin.');
  }
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid.');

  let orderPolicy;
  if (rawLocations || rawDuration || rawFee) {
    const locationIds = (rawLocations ?? '').split(',').map((value) => orderUuid(value.trim()));
    const reservationSeconds = Number(rawDuration);
    const deliveryFeeClp = Number(rawFee || 0);
    if (!Number.isInteger(reservationSeconds) || reservationSeconds < 1 || reservationSeconds > maxInteger
      || !Number.isInteger(deliveryFeeClp) || deliveryFeeClp < 0 || deliveryFeeClp > maxInteger) {
      throw new Error('Configure a valid ORDER_RESERVATION_SECONDS and ORDER_DELIVERY_FEE_CLP.');
    }
    orderPolicy = { locationIds, reservationSeconds, deliveryFeeClp };
  }
  return {
    origin: url.origin, secret, from, orderPolicy,
    smtp: {
      host, port, secure: port === 465, requireTLS: url.protocol === 'https:' || Boolean(user),
      ...(user && pass && { auth: { user, pass } }),
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    },
  };
}
