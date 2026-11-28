import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAuthConfig } from '../src/modules/auth/auth-config.js';

const localEnv = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://127.0.0.1:5173',
  SMTP_HOST: 'mailpit',
  SMTP_FROM: 'farmacia@example.test',
};

test('simulated payments are off unless opted into local development', () => {
  assert.equal(readAuthConfig(localEnv)?.demoPayments, false);
  assert.equal(readAuthConfig({ ...localEnv, ORDER_DEMO_PAYMENTS: 'true' })?.demoPayments, true);
  assert.throws(() => readAuthConfig({
    ...localEnv, ORDER_DEMO_PAYMENTS: 'true', BETTER_AUTH_URL: 'https://farmacia.example.test',
  }), /only be enabled in local HTTP development/);
  assert.throws(() => readAuthConfig({
    ...localEnv, ORDER_DEMO_PAYMENTS: 'true', NODE_ENV: 'production',
  }), /only be enabled in local HTTP development/);
});
