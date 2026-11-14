import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Receta } from '../src/features/cuenta/cuenta.api.js';
import {
  MESES_VIGENCIA_RECETA,
  fechaVencimientoReceta,
  formatearRestante,
  recetaVigente,
  vigenciaReceta,
} from '../src/features/cuenta/vigencia.js';

function receta(estado: Receta['estado'], venceEn: string | null): Receta {
  return {
    id: 'r1',
    estado,
    archivoNombre: 'receta.pdf',
    archivoTipo: 'application/pdf',
    observaciones: null,
    revisadoPor: null,
    revisadoEn: null,
    creadoEn: new Date(2026, 7, 31, 12).toISOString(),
    venceEn,
    items: [],
  };
}

test('la vigencia es de 6 meses y respeta el fin de mes', () => {
  assert.equal(MESES_VIGENCIA_RECETA, 6);
  const vence = fechaVencimientoReceta({
    ...receta('ACEPTADA', null),
    revisadoEn: new Date(2026, 7, 31, 12).toISOString(),
    creadoEn: new Date(2026, 7, 31, 12).toISOString(),
  });
  assert.equal(vence?.getFullYear(), 2027);
  assert.equal(vence?.getMonth(), 1);
  assert.equal(vence?.getDate(), 28);
});

test('la fecha del servidor prevalece sobre el cálculo local', () => {
  const vence = fechaVencimientoReceta(
    receta('ACEPTADA', new Date(2027, 4, 14, 12).toISOString()),
  );
  assert.equal(vence?.toISOString(), new Date(2027, 4, 14, 12).toISOString());
});

test('una receta vencida deja de estar vigente', () => {
  const aceptada = receta('ACEPTADA', new Date(2026, 10, 14, 12).toISOString());
  assert.equal(recetaVigente(aceptada, new Date(2026, 10, 13, 9)), true);
  assert.equal(recetaVigente(aceptada, new Date(2026, 10, 15, 9)), false);
});

test('solo las recetas aceptadas tienen vigencia', () => {
  assert.equal(fechaVencimientoReceta(receta('PENDIENTE', null)), null);
  assert.equal(vigenciaReceta(receta('RECHAZADA', null)), null);
});

test('muestra los meses y días restantes', () => {
  const aceptada = receta('ACEPTADA', new Date(2027, 4, 14, 12).toISOString());

  const seisMeses = vigenciaReceta(aceptada, new Date(2026, 10, 14, 9));
  assert.equal(seisMeses?.meses, 6);
  assert.equal(seisMeses?.dias, 0);
  assert.equal(seisMeses?.texto, '6 meses');
  assert.equal(seisMeses?.vencida, false);

  const mixto = vigenciaReceta(aceptada, new Date(2027, 0, 10, 9));
  assert.equal(mixto?.meses, 4);
  assert.equal(mixto?.dias, 4);
  assert.equal(mixto?.texto, '4 meses y 4 días');

  const soloDias = vigenciaReceta(aceptada, new Date(2027, 4, 1, 9));
  assert.equal(soloDias?.meses, 0);
  assert.equal(soloDias?.dias, 13);
  assert.equal(soloDias?.texto, '13 días');

  const vencida = vigenciaReceta(aceptada, new Date(2027, 5, 1, 9));
  assert.equal(vencida?.vencida, true);
});

test('formatea singulares y el mismo día', () => {
  assert.equal(formatearRestante(1, 1), '1 mes y 1 día');
  assert.equal(formatearRestante(0, 0), 'vence hoy');
});
