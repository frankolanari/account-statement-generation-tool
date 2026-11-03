import { schemaTask, metadata } from '@trigger.dev/sdk';
import { lookupRequestSchema, generationRequestSchema, naturalLanguageRequestSchema, DomainError } from '../domain/contracts.js';
import { lookupAccountService } from '../services/engine.js';
import { createRuntime } from '../services/runtime.js';
import { createDatabaseRuntime } from '../services/database.js';

export const lookupAccount = schemaTask({
  id: 'statement.lookup-account', schema: lookupRequestSchema,
  queue: { concurrencyLimit: 5 },
  run: async payload => {
    const database = createDatabaseRuntime();
    try {
      metadata.set('stage', 'resolving_account');
      const result = await lookupAccountService(database.accounts, payload);
      metadata.set('stage', 'completed');
      return result;
    } finally { await database.close(); }
  },
});

export const generateStatement = schemaTask({
  id: 'statement.generate', schema: generationRequestSchema,
  queue: { concurrencyLimit: 3 },
  run: async payload => {
    const runtime = createRuntime();
    try {
      const result = await runtime.engine.generate(payload, stage => { metadata.set('stage', stage); });
      metadata.set('stage', 'completed');
      return result;
    } catch (error) {
      if (error instanceof DomainError) {
        metadata.set('stage', 'rejected');
        return { status: 'REJECTED' as const, code: error.code, message: error.message, requestId: payload.requestId };
      }
      // Operational failures remain errors so Trigger.dev can retry them.
      throw error;
    } finally { await runtime.close(); }
  },
});


// Natural-language sources use this adapter task; structured inputs keep using the tasks above.
export const generateFromText = schemaTask({
  id: 'statement.generate-from-text', schema: naturalLanguageRequestSchema,
  queue: { concurrencyLimit: 3 },
  run: async payload => {
    const { createOpenRouterDateExtractor } = await import('../adapters/openrouter.js');
    const { fulfilTextRequest } = await import('../services/text-request.js');
    const result = await fulfilTextRequest(payload, { extractor: createOpenRouterDateExtractor(),
      openDatabase: createDatabaseRuntime, openRuntime: createRuntime, report: stage => { metadata.set('stage', stage); } });
    metadata.set('stage', result.status === 'REJECTED' ? 'rejected' : 'completed');
    return result;
  },
});
