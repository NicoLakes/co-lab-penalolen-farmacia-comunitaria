import { defaultPrescriptionPaymentSeconds, maxInteger, orderUuid } from '../orders/order-input.js';

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.BETTER_AUTH_SECRET;
  const baseUrl = env.BETTER_AUTH_URL;
  const host = env.SMTP_HOST;
  const from = env.SMTP_FROM;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  const rawLocations = env.ORDER_LOCATION_IDS;
  const rawDuration = env.ORDER_RESERVATION_SECONDS;
  const rawPrescriptionDuration = env.ORDER_PRESCRIPTION_PAYMENT_SECONDS;
  const rawFee = env.ORDER_DELIVERY_FEE_CLP;
  const rawStorageDir = env.PRESCRIPTION_STORAGE_DIR;
  const rawDemoPayments = env.ORDER_DEMO_PAYMENTS;
  if (![
    secret, baseUrl, host, from, user, pass, env.SMTP_PORT,
    rawLocations, rawDuration, rawPrescriptionDuration, rawFee, rawDemoPayments,
  ].some(Boolean)) return;

  if (!secret || secret.length < 32 || !host || !from || /[\r\n]/.test(from) || Boolean(user) !== Boolean(pass)) {
    throw new Error('Set BETTER_AUTH_SECRET, SMTP_HOST and SMTP_FROM. SMTP credentials must be configured together.');
  }
  const url = URL.parse(baseUrl ?? '');
  const loopback = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BETTER_AUTH_URL must be the public HTTPS origin or a local loopback HTTP origin.');
  }
  if (rawDemoPayments && rawDemoPayments !== 'true' && rawDemoPayments !== 'false') {
    throw new Error('ORDER_DEMO_PAYMENTS must be true or false.');
  }
  if (rawDemoPayments === 'true' && (!loopback || url.protocol !== 'http:' || env.NODE_ENV === 'production')) {
    throw new Error('ORDER_DEMO_PAYMENTS can only be enabled in local HTTP development.');
  }
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT is invalid.');

  const prescriptionStorageDir = rawStorageDir?.trim() || '/var/lib/farmacia/prescriptions';
  if (/[\0\r\n]/.test(prescriptionStorageDir)) {
    throw new Error('PRESCRIPTION_STORAGE_DIR is invalid.');
  }

  let orderPolicy;
  if (rawLocations || rawDuration || rawFee || rawPrescriptionDuration) {
    const locationIds = (rawLocations ?? '').split(',').map((value) => orderUuid(value.trim()));
    const reservationSeconds = Number(rawDuration);
    const prescriptionPaymentSeconds = rawPrescriptionDuration
      ? Number(rawPrescriptionDuration)
      : defaultPrescriptionPaymentSeconds;
    const deliveryFeeClp = Number(rawFee || 0);
    if (!Number.isInteger(reservationSeconds) || reservationSeconds < 1 || reservationSeconds > maxInteger
      || !Number.isInteger(prescriptionPaymentSeconds) || prescriptionPaymentSeconds < 1 || prescriptionPaymentSeconds > maxInteger
      || !Number.isInteger(deliveryFeeClp) || deliveryFeeClp < 0 || deliveryFeeClp > maxInteger) {
      throw new Error('Configure valid ORDER_RESERVATION_SECONDS, ORDER_PRESCRIPTION_PAYMENT_SECONDS and ORDER_DELIVERY_FEE_CLP.');
    }
    orderPolicy = { locationIds, reservationSeconds, prescriptionPaymentSeconds, deliveryFeeClp };
  }
  return {
    origin: url.origin, secret, from, orderPolicy, prescriptionStorageDir,
    demoPayments: rawDemoPayments === 'true',
    smtp: {
      host, port, secure: port === 465, requireTLS: url.protocol === 'https:' || Boolean(user),
      ...(user && pass && { auth: { user, pass } }),
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    },
  };
}
