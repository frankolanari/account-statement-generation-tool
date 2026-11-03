import { createAppApi } from '@/src/app-api/handlers';
import { bearerTokenAuthorizer } from '@/src/app-api/token';
import { createPasscodeGate } from '@/src/app-api/passcode';
import { createRuntime } from '@/src/services/runtime';

// Created on first use, not at import, so `next build` works without runtime secrets.
let gate: ReturnType<typeof createPasscodeGate> | undefined;
let tool: ReturnType<typeof createAppApi> | undefined;
let statement: ReturnType<typeof createAppApi> | undefined;

export const passcodeGate = () => (gate ??= createPasscodeGate(process.env.TOOL_PASSCODES));
// The internal tool: signed-in browser sessions.
export const toolApi = () => (tool ??= createAppApi({ authorize: async req => passcodeGate().isValidRequest(req), openRuntime: createRuntime }));
// The one-call API: server-to-server bearer tokens.
export const statementApi = () =>
  (statement ??= createAppApi({ authorize: bearerTokenAuthorizer(process.env.STATEMENT_API_TOKEN), openRuntime: createRuntime }));
