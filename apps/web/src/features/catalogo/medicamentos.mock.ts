// 1. Este "interface" es el molde: obliga a que todo medicamento tenga estos campos
export interface Medicamento {
  codigo: string;                   // Columna Excel: CODIGO
  principioActivo: string;          // Columna Excel: Principio Activo
  descriptor: string;               // Columna Excel: Descriptor 1016
  formaFarmaceutica: string;        // Columna Excel: Forma Farmaceutica
  presentacion: string;             // Columna Excel: Presentación
  proveedor: string;                // Columna Excel: Proveedor
  clasificacionTerapeutica: string; // Columna Excel: Clasificación Terapéutica
  // Campos extra agregados por nosotros:
  precio: number;
  stock: number;
  requiereReceta: boolean;
}

// 2. Datos iniciales sacados del excel municipalidad
export const MEDICAMENTOS_INICIALES: Medicamento[] = [
  {
    codigo: '11313',
    principioActivo: 'AC. ACETIL SALICILICO 100 MG',
    descriptor: 'ACIDO ACETILSALICILICO 100 MG X 100 COMP',
    formaFarmaceutica: 'COMPRIMIDO',
    presentacion: '100 comprimidos',
    proveedor: 'MINTLAB',
    clasificacionTerapeutica: 'CARDIOVASCULAR',
    precio: 1490,
    stock: 45,
    requiereReceta: false,
  },
  {
    codigo: '9231',
    principioActivo: 'ACENOCUMAROL 4 MG',
    descriptor: 'ACENOCUMAROL 4mg X 20 COMP',
    formaFarmaceutica: 'COMPRIMIDO',
    presentacion: '20 comprimidos',
    proveedor: 'ABBOTT',
    clasificacionTerapeutica: 'CARDIOVASCULAR',
    precio: 2850,
    stock: 18,
    requiereReceta: true,
  },
  {
    codigo: '1991',
    principioActivo: 'ACIDO VALPROICO 375 MG/ML',
    descriptor: 'ATEMPERATOR 375MG/ML GOTAS ORALES',
    formaFarmaceutica: 'SOLUCION GOTAS ORALES',
    presentacion: 'Frasco Gotario 15 ml',
    proveedor: 'FERRER',
    clasificacionTerapeutica: 'SALUD MENTAL',
    precio: 6400,
    stock: 12,
    requiereReceta: true,
  },
  {
    codigo: '10464',
    principioActivo: 'ACIDO MEFENAMICO 500 MG',
    descriptor: 'ACIDO MEFENAMICO 500 MG X 10 COMP',
    formaFarmaceutica: 'COMPRIMIDO',
    presentacion: '10 comprimidos',
    proveedor: 'CARIBEAN',
    clasificacionTerapeutica: 'ANALGESICO',
    precio: 990,
    stock: 30,
    requiereReceta: false,
  },
  {
    codigo: '14979',
    principioActivo: 'ACIDO ALENDRONICO 70 MG',
    descriptor: 'ALDROX 70 MG X 10 COMPRIMIDOS',
    formaFarmaceutica: 'COMPRIMIDO RECUBIERTO',
    presentacion: '10 comprimidos recubiertos',
    proveedor: 'SAVAL',
    clasificacionTerapeutica: 'ARTRITIS, ARTROSIS',
    precio: 3900,
    stock: 8,
    requiereReceta: true,
  },
  {
    codigo: '15600',
    principioActivo: 'ALCOHOL 70°',
    descriptor: 'ALCOHOL 70° LITRO (F)',
    formaFarmaceutica: 'DISPOSITIVO MEDICO',
    presentacion: 'Frasco 1 litro',
    proveedor: 'CARIBEAN',
    clasificacionTerapeutica: 'INSUMO MEDICO',
    precio: 1800,
    stock: 60,
    requiereReceta: false,
  },
];
