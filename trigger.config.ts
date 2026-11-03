import { defineConfig } from '@trigger.dev/sdk';
import { additionalFiles } from '@trigger.dev/build/extensions/core';
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || 'proj_your_project_ref',
  legacyDevProcessCwdBehaviour: false,
  build: { external: ['snowflake-sdk'], extensions: [additionalFiles({ files: ['./core-files/**/*.sql', './core-files/**/*.json'] })] },
  runtime: 'node', dirs: ['./src/trigger'], maxDuration: 300,
  retries: { enabledInDev: false, default: {
    maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2, randomize: true,
  } },
});
