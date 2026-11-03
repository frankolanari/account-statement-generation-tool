import { schedules, logger } from '@trigger.dev/sdk';
import { createDatabaseRuntime } from '../services/database.js';
import { KEEP_ALIVE_CRON, pingDatabase } from '../services/keep-alive.js';

// Declared in code, so it is created or updated by `trigger deploy`. Production only: dev runs would just add noise.
export const keepDatabaseAlive = schedules.task({
  id: 'maintenance.keep-database-alive',
  cron: { pattern: KEEP_ALIVE_CRON, timezone: 'UTC', environments: ['PRODUCTION'] },
  maxDuration: 60,
  run: async () => {
    const database = createDatabaseRuntime();
    try {
      const result = await pingDatabase(database.accounts);
      logger.info('Database ping succeeded', result);
      return result;
    } finally { await database.close(); }
  },
});
