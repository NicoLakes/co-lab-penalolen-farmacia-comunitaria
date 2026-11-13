import type { Database } from '@farmacia/database';
import type { FastifyInstance } from 'fastify';
import { listPublishedCatalog } from './catalog.service.js';

export function registerCatalogRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/catalog', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const items = await listPublishedCatalog(db);
    return { items };
  });
}
