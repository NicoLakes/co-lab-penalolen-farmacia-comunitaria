import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siguientesSegunModalidad } from '../src/features/admin/pedidos.modalidad.js';

test('un pedido de retiro no ofrece el paso a despacho', () => {
  assert.deepEqual(siguientesSegunModalidad('EN_PREPARACION', 'RETIRO'), [
    'LISTO_PARA_RETIRO',
    'CANCELADO',
  ]);
});

test('un pedido de delivery ofrece despacho y no retiro', () => {
  assert.deepEqual(siguientesSegunModalidad('EN_PREPARACION', 'DELIVERY'), [
    'EN_DESPACHO',
    'CANCELADO',
  ]);
});

test('las etapas comunes no dependen de la modalidad', () => {
  assert.deepEqual(siguientesSegunModalidad('RECIBIDO', 'RETIRO'), ['EN_PREPARACION', 'CANCELADO']);
  assert.deepEqual(siguientesSegunModalidad('RECIBIDO', 'DELIVERY'), [
    'EN_PREPARACION',
    'CANCELADO',
  ]);
});
