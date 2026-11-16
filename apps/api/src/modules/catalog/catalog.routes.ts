import type { Database } from '@farmacia/database';
import type { FastifyInstance } from 'fastify';
import type { OrderPolicy } from '../orders/order-input.js';
import { listPublishedCatalog } from './catalog.service.js';

export function registerCatalogRoutes(app: FastifyInstance, db: Database, policy?: OrderPolicy) {
  app.get('/api/catalog', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const items = await listPublishedCatalog(db, policy?.locationIds);
    return { items, deliveryFeeClp: policy?.deliveryFeeClp ?? null };
  });
}
