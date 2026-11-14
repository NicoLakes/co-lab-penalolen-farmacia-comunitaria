import { eq } from 'drizzle-orm';
import { createDatabase } from '@farmacia/database';
import { schema } from '@farmacia/database';
import { hashPassword } from './modules/auth/password.js';

// Datos iniciales del catálogo, sacados del Excel de la Municipalidad.
const MEDICAMENTOS = [
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

// Usuarios de prueba del panel. Contraseña por variable de entorno (solo local).
const USUARIOS = [
  {
    email: 'admin@farmacia.local',
    nombre: 'Administración',
    rol: 'admin' as const,
    password: process.env.SEED_ADMIN_PASSWORD ?? 'admin123',
  },
  {
    email: 'funcionario@farmacia.local',
    nombre: 'Funcionaria Farmacia',
    rol: 'funcionario' as const,
    password: process.env.SEED_FUNCIONARIO_PASSWORD ?? 'funcionario123',
  },
];

async function main() {
  const { db, pool } = createDatabase({
    onPoolError: (error) => console.error('Error de pool:', error),
  });

  try {
    for (const medicamento of MEDICAMENTOS) {
      await db.insert(schema.medicamentos).values(medicamento).onConflictDoNothing({
        target: schema.medicamentos.codigo,
      });
    }

    for (const usuario of USUARIOS) {
      const existente = await db
        .select({ id: schema.usuarios.id })
        .from(schema.usuarios)
        .where(eq(schema.usuarios.email, usuario.email));
      if (existente.length > 0) continue;

      await db.insert(schema.usuarios).values({
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
        passwordHash: await hashPassword(usuario.password),
      });
    }

    console.log('Seed completado: medicamentos del catálogo y usuarios del panel.');
    console.log('Usuarios del panel (solo desarrollo):');
    for (const usuario of USUARIOS) console.log(`  - ${usuario.email} (${usuario.rol})`);
  } finally {
    await pool.end();
  }
}

await main();
