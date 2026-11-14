// Contrato del catálogo compartido entre el portal y el panel de admin.
export interface Medicamento {
  codigo: string;
  principioActivo: string;
  descriptor: string;
  formaFarmaceutica: string;
  presentacion: string;
  proveedor: string;
  clasificacionTerapeutica: string;
  precio: number;
  stock: number;
  requiereReceta: boolean;
}

// Valida que la respuesta de la API cumpla el contrato antes de usarla.
function esMedicamento(valor: unknown): valor is Medicamento {
  if (typeof valor !== 'object' || valor === null) return false;
  const m = valor as Record<string, unknown>;
  return (
    typeof m.codigo === 'string' &&
    typeof m.principioActivo === 'string' &&
    typeof m.descriptor === 'string' &&
    typeof m.formaFarmaceutica === 'string' &&
    typeof m.presentacion === 'string' &&
    typeof m.proveedor === 'string' &&
    typeof m.clasificacionTerapeutica === 'string' &&
    typeof m.precio === 'number' &&
    typeof m.stock === 'number' &&
    typeof m.requiereReceta === 'boolean'
  );
}

// Descarga el catálogo vivo desde la API (fuente única de datos).
export async function listarMedicamentos(): Promise<Medicamento[]> {
  const response = await fetch('/api/medicamentos', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('No se pudo cargar el catálogo.');

  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('medicamentos' in body) ||
    !Array.isArray(body.medicamentos)
  ) {
    throw new Error('La API devolvió una respuesta inválida.');
  }
  if (!body.medicamentos.every(esMedicamento)) {
    throw new Error('La API devolvió medicamentos con formato inválido.');
  }
  return body.medicamentos;
}
