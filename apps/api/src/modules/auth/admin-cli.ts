import { createDatabase } from '@farmacia/database';
import { findManagedUser, setUserRole } from './access.js';

async function main() {
  const [operation, email] = process.argv.slice(2);
  if ((operation !== 'grant' && operation !== 'revoke') || !email) {
    throw new Error('Usage: pnpm --filter api auth:admin <grant|revoke> <email>');
  }
  const { db, pool } = createDatabase({ onPoolError: () => console.error('Database connection failed') });
  try {
    const user = await findManagedUser(db, email);
    if (!user) throw new Error('The user must sign in and open their account first.');
    const result = await setUserRole(db, user.id, 'user_admin', operation === 'grant');
    if (result !== 'ok') throw new Error('The account is unavailable for this change.');
    console.info('Administrator access updated.');
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Error && error.cause === undefined) console.error(error.message);
  else console.error('Administrator access could not be updated.');
  process.exitCode = 1;
}
