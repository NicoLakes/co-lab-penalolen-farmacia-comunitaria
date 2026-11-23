import type { Database } from '@farmacia/database';
import { expirePendingOrders } from './order-lifecycle.js';

export interface ExpirationJobLogger {
  info: (obj: Record<string, unknown>, message: string) => void;
  error: (obj: Record<string, unknown>, message: string) => void;
}

export interface ExpirationJobOptions {
  intervalMs?: number;
  batchSize?: number;
  runBatch?: (db: Database, limit: number) => Promise<number>;
}

export const defaultExpirationIntervalMs = 60_000;
export const defaultExpirationBatchSize = 100;

export function startOrderExpirationJob(
  db: Database,
  logger: ExpirationJobLogger,
  options: ExpirationJobOptions = {},
) {
  const intervalMs = options.intervalMs ?? defaultExpirationIntervalMs;
  const batchSize = options.batchSize ?? defaultExpirationBatchSize;
  const runBatch = options.runBatch ?? expirePendingOrders;

  let running = false;
  let stopped = false;

  const sweep = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const expired = await runBatch(db, batchSize);
      if (expired > 0) {
        logger.info({ expired }, 'Expired unpaid order reservations');
      }
    } catch (error) {
      logger.error({ err: error }, 'Order expiration sweep failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);
  timer.unref();

  return {
    sweep,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
