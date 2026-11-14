import type { Receta } from './cuenta.api';

// La receta debe renovarse cada 6 meses desde que el funcionario la acepta.
export const MESES_VIGENCIA_RECETA = 6;

export interface VigenciaReceta {
  venceEn: Date;
  vencida: boolean;
  meses: number;
  dias: number;
  texto: string;
}

function sumarMeses(fecha: Date, meses: number): Date {
  const resultado = new Date(fecha);
  const dia = resultado.getDate();
  resultado.setDate(1);
  resultado.setMonth(resultado.getMonth() + meses);
  const ultimoDia = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate();
  resultado.setDate(Math.min(dia, ultimoDia));
  return resultado;
}

export function fechaVencimientoReceta(receta: Receta): Date | null {
  if (receta.estado !== 'ACEPTADA') return null;
  if (receta.venceEn) return new Date(receta.venceEn);
  const base = receta.revisadoEn ?? receta.creadoEn;
  return sumarMeses(new Date(base), MESES_VIGENCIA_RECETA);
}

export function recetaVigente(receta: Receta, ahora: Date = new Date()): boolean {
  const venceEn = fechaVencimientoReceta(receta);
  return venceEn !== null && venceEn.getTime() > ahora.getTime();
}

export function formatearRestante(meses: number, dias: number): string {
  const partes: string[] = [];
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mes' : 'meses'}`);
  if (dias > 0) partes.push(`${dias} ${dias === 1 ? 'día' : 'días'}`);
  return partes.length > 0 ? partes.join(' y ') : 'vence hoy';
}

// Meses y días que le quedan a la receta aceptada.
export function vigenciaReceta(
  receta: Receta,
  ahora: Date = new Date(),
): VigenciaReceta | null {
  const venceEn = fechaVencimientoReceta(receta);
  if (!venceEn) return null;

  const vencida = venceEn.getTime() <= ahora.getTime();
  let meses = 0;
  let dias = 0;

  if (!vencida) {
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const fin = new Date(venceEn.getFullYear(), venceEn.getMonth(), venceEn.getDate());
    meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + fin.getMonth() - hoy.getMonth();
    let ancla = sumarMeses(hoy, meses);
    if (ancla.getTime() > fin.getTime()) {
      meses -= 1;
      ancla = sumarMeses(hoy, meses);
    }
    dias = Math.max(0, Math.round((fin.getTime() - ancla.getTime()) / 86_400_000));
  }

  return { venceEn, vencida, meses, dias, texto: formatearRestante(meses, dias) };
}
