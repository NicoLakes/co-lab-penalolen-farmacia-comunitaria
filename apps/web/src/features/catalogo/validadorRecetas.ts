import type { Medicamento } from './medicamentos.mock';

// Posibles resultados del análisis de la receta
export type EstadoValidacionReceta =
  | 'PENDIENTE'
  | 'ANALIZANDO'
  | 'APROBADA_DIGITAL'
  | 'REVISION_ADMIN';

export interface ResultadoValidacionReceta {
  estado: EstadoValidacionReceta;
  tipoDetectado: 'DIGITAL' | 'MANUSCRITA_O_IMAGEN';
  mensaje: string;
  medicamentosReconocidos: string[];
}

// Función auxiliar: pasa a mayúsculas y quita tildes (ej: "Ácido" -> "ACIDO")
function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export async function analizarRecetaMedica(
  archivo: File,
  medicamentosConReceta: Medicamento[],
): Promise<ResultadoValidacionReceta> {
  const nombreArchivo = normalizarTexto(archivo.name);
  const esImagen =
    archivo.type.startsWith('image/') ||
    /\.(JPG|JPEG|PNG|WEBP|HEIC)$/i.test(archivo.name);

  // 1. Si sube una foto o el archivo dice "manuscrita", pasa directo a revisión humana
  if (esImagen || nombreArchivo.includes('MANUSCRITA')) {
    return {
      estado: 'REVISION_ADMIN',
      tipoDetectado: 'MANUSCRITA_O_IMAGEN',
      mensaje:
        'Se detectó una receta en formato imagen o manuscrita. Tu solicitud será revisada por el Químico-Farmacéutico de la municipalidad antes de habilitar el pago.',
      medicamentosReconocidos: [],
    };
  }

  // 2. Si es PDF o documento digital, leemos su contenido interno
  const contenidoCrudo = await archivo.text();
  const textoDocumento = normalizarTexto(contenidoCrudo + ' ' + archivo.name);

  const reconocidos: string[] = [];

  for (const med of medicamentosConReceta) {
    // Extraemos la palabra clave principal del principio activo o nombre comercial
    // Ej: de "ACIDO VALPROICO 375 MG/ML" o "ATEMPERATOR..." buscamos palabras de más de 4 letras
    const palabrasClave = normalizarTexto(
      `${med.principioActivo} ${med.descriptor}`,
    )
      .split(/[^A-Z0-9]+/)
      .filter((palabra) => palabra.length >= 5 && palabra !== 'ACIDO' && palabra !== 'COMPRIMIDOS');

    const encontrado = palabrasClave.some((palabra) =>
      textoDocumento.includes(palabra),
    );

    if (encontrado) {
      reconocidos.push(med.principioActivo);
    }
  }

  // 3. Si reconoció todos los medicamentos con receta del carrito en el documento digital
  if (reconocidos.length === medicamentosConReceta.length && reconocidos.length > 0) {
    return {
      estado: 'APROBADA_DIGITAL',
      tipoDetectado: 'DIGITAL',
      mensaje:
        'Receta electrónica verificada automáticamente. Todos los medicamentos sujetos a control coinciden con la prescripción digital.',
      medicamentosReconocidos: reconocidos,
    };
  }

  // 4. Si es un PDF escaneado (sin texto legible) o no se pudo confirmar algún medicamento
  return {
    estado: 'REVISION_ADMIN',
    tipoDetectado: 'MANUSCRITA_O_IMAGEN',
    mensaje:
      'No fue posible verificar automáticamente todos los fármacos en el documento digital (posible receta escaneada o manuscrita). Un Químico-Farmacéutico validará tu receta.',
    medicamentosReconocidos: reconocidos,
  };
}