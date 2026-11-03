import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPasscodeGate } from '../src/app-api/passcode.js';

test('a correct passcode yields a session that validates', () => {
  const gate = createPasscodeGate('open-sesame-1, second-code-2');
  const session = gate.sessionFor('second-code-2');
  assert.ok(session); assert.equal(gate.isValidSession(session), true);
  assert.equal(gate.sessionFor('wrong-code'), null);
  assert.equal(gate.isValidSession(undefined), false);
  assert.equal(gate.isValidSession('not-a-session'), false);
});
test('changing the passcode list logs existing sessions out', () => {
  const session = createPasscodeGate('open-sesame-1').sessionFor('open-sesame-1')!;
  assert.equal(createPasscodeGate('brand-new-code').isValidSession(session), false);
});
test('an expired passcode neither logs in nor keeps sessions alive', () => {
  const before = () => new Date('2026-11-30T12:00:00Z'), after = () => new Date('2026-12-01T00:00:00Z');
  const session = createPasscodeGate('open-sesame-1:2026-11-30', before).sessionFor('open-sesame-1')!;
  assert.ok(session);
  assert.equal(createPasscodeGate('open-sesame-1:2026-11-30', after).isValidSession(session), false);
  assert.equal(createPasscodeGate('open-sesame-1:2026-11-30', after).sessionFor('open-sesame-1'), null);
});
test('sessions are not the passcode itself', () => {
  assert.ok(!createPasscodeGate('open-sesame-1').sessionFor('open-sesame-1')!.includes('open-sesame-1'));
});
test('missing or too-short passcodes fail at startup', () => {
  assert.throws(() => createPasscodeGate(undefined), /TOOL_PASSCODES/);
  assert.throws(() => createPasscodeGate('short'), /TOOL_PASSCODES/);
});
test('session cookies are read from a request cookie header', () => {
  const gate = createPasscodeGate('open-sesame-1');
  const session = gate.sessionFor('open-sesame-1')!;
  const req = new Request('https://x', { headers: { cookie: `other=1; stmt_session=${session}` } });
  assert.equal(gate.isValidRequest(req), true);
  assert.equal(gate.isValidRequest(new Request('https://x')), false);
});
