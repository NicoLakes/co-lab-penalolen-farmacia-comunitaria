import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ordenarPedidos } from '../src/features/admin/pedidos.orden.js';
import type { Pedido } from '../src/features/admin/admin.api.js';

function pedido(numero: number, creadoEn: string): Pedido {
  return {
    id: `p${numero}`,
    numero,
    clienteNombre: 'Ana Pérez',
    contacto: '987654321',
    modalidad: 'RETIRO',
    direccion: null,
    estado: 'RECIBIDO',
    items: [],
    total: 1000,
    creadoEn,
  };
}

test('ordena de más reciente a más antiguo por defecto', () => {
  const lista = [
    pedido(1, '2026-11-14T10:00:00.000Z'),
    pedido(2, '2026-11-15T10:00:00.000Z'),
    pedido(3, '2026-11-13T10:00:00.000Z'),
  ];

  assert.deepEqual(
    ordenarPedidos(lista, 'recientes').map((p) => p.numero),
    [2, 1, 3],
  );
  assert.deepEqual(
    ordenarPedidos(lista, 'antiguos').map((p) => p.numero),
    [3, 1, 2],
  );
});

test('no modifica la lista original', () => {
  const lista = [pedido(1, '2026-11-14T10:00:00.000Z'), pedido(2, '2026-11-15T10:00:00.000Z')];
  ordenarPedidos(lista, 'recientes');
  assert.deepEqual(lista.map((p) => p.numero), [1, 2]);
});

test('las fechas en la misma hora se resuelven sin error', () => {
  const lista = [pedido(5, '2026-11-14T10:00:00.000Z'), pedido(7, '2026-11-14T10:00:00.000Z')];
  assert.equal(ordenarPedidos(lista, 'recientes').length, 2);
  assert.equal(ordenarPedidos(lista, 'antiguos').length, 2);
});
