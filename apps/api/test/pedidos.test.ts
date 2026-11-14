import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADOS_PEDIDO } from '@farmacia/database/schema';
import type { EstadoPedido } from '@farmacia/database/schema';
import { esTransicionValida, transicionesPermitidas } from '../src/modules/pedidos/pedidos.service.js';

test('flujo lineal de retiro: RECIBIDO → EN_PREPARACION → LISTO_PARA_RETIRO → ENTREGADO', () => {
  const retiro: Array<[EstadoPedido, EstadoPedido]> = [
    ['RECIBIDO', 'EN_PREPARACION'],
    ['EN_PREPARACION', 'LISTO_PARA_RETIRO'],
    ['LISTO_PARA_RETIRO', 'ENTREGADO'],
  ];
  for (const [actual, siguiente] of retiro) {
    assert.equal(esTransicionValida(actual, siguiente, 'RETIRO'), true, `${actual} → ${siguiente}`);
  }
});

test('flujo lineal de delivery: RECIBIDO → EN_PREPARACION → EN_DESPACHO → ENTREGADO', () => {
  const delivery: Array<[EstadoPedido, EstadoPedido]> = [
    ['RECIBIDO', 'EN_PREPARACION'],
    ['EN_PREPARACION', 'EN_DESPACHO'],
    ['EN_DESPACHO', 'ENTREGADO'],
  ];
  for (const [actual, siguiente] of delivery) {
    assert.equal(esTransicionValida(actual, siguiente, 'DELIVERY'), true, `${actual} → ${siguiente}`);
  }
});

test('LISTO_PARA_RETIRO no aplica a delivery ni EN_DESPACHO a retiro', () => {
  assert.equal(esTransicionValida('EN_PREPARACION', 'LISTO_PARA_RETIRO', 'DELIVERY'), false);
  assert.equal(esTransicionValida('EN_PREPARACION', 'EN_DESPACHO', 'RETIRO'), false);
});

test('no se saltan etapas ni se reabren estados finales', () => {
  assert.equal(esTransicionValida('RECIBIDO', 'ENTREGADO', 'RETIRO'), false);
  assert.equal(esTransicionValida('RECIBIDO', 'LISTO_PARA_RETIRO', 'RETIRO'), false);
  assert.equal(esTransicionValida('ENTREGADO', 'RECIBIDO', 'RETIRO'), false);
  assert.equal(esTransicionValida('CANCELADO', 'EN_PREPARACION', 'DELIVERY'), false);
});

test('cancelar es posible desde cualquier estado en curso, no desde los finales', () => {
  for (const estado of ['RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_RETIRO', 'EN_DESPACHO'] as const) {
    assert.equal(esTransicionValida(estado, 'CANCELADO', 'RETIRO'), true, estado);
    assert.equal(esTransicionValida(estado, 'CANCELADO', 'DELIVERY'), true, estado);
  }
  assert.equal(esTransicionValida('ENTREGADO', 'CANCELADO', 'RETIRO'), false);
  assert.equal(esTransicionValida('CANCELADO', 'CANCELADO', 'RETIRO'), false);
});

test('los estados finales no permiten ninguna salida', () => {
  for (const final of ['ENTREGADO', 'CANCELADO'] as const) {
    assert.equal(transicionesPermitidas(final).length, 0);
    for (const destino of ESTADOS_PEDIDO) {
      assert.equal(esTransicionValida(final, destino, 'RETIRO'), false, `${final} → ${destino}`);
    }
  }
});
