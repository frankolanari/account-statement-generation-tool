import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type CoreAsset = 'sql/user-query.sql' | 'sql/transaction-query.sql' | 'sql/snowflake/user-query.sql' | 'sql/snowflake/transaction-query.sql' | 'pdf-options.json';

// Trigger.dev copies these assets into the same project-relative directory.
// Run the local webhook server from the repository root as documented.
export function readCoreFile(file: CoreAsset): string {
  return readFileSync(resolve(process.cwd(), 'core-files', file), 'utf8');
}
