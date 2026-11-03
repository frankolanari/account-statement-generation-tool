import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPresets, dayAfter, daysBetween, earliestStart, parseApiError, pickerMin } from '../lib/statement-ui.js';

test('earliest start is January 1 of the first transaction year', () => {
  assert.equal(earliestStart('2024-11-21'), '2024-01-01');
  assert.equal(earliestStart('2021-03-14T09:30:00.000Z'), '2021-01-01');
});
test('presets: full history starts at the first transaction; the others are calendar windows ending today', () => {
  const presets = buildPresets('2024-11-21', '2026-10-28');
  const by = Object.fromEntries(presets.map(p => [p.label, p.range]));
  assert.deepEqual(presets.map(p => p.label), ['Full history', 'This year', '30 days', '90 days', '12 months']);
  assert.deepEqual(by['Full history'], { from: '2024-11-21', to: '2026-10-28' });
  assert.deepEqual(by['This year'], { from: '2026-01-01', to: '2026-10-28' });
  assert.deepEqual(by['30 days'], { from: '2026-09-29', to: '2026-10-28' });
  assert.deepEqual(by['12 months'], { from: '2025-10-29', to: '2026-10-28' });
});
test('rolling presets cover the true window even for a new account; This year starts Jan 1', () => {
  const by = Object.fromEntries(buildPresets('2026-05-02', '2026-10-28').map(p => [p.label, p.range]));
  assert.deepEqual(by['12 months'], { from: '2025-10-29', to: '2026-10-28' });
  assert.deepEqual(by['90 days'], { from: '2026-07-31', to: '2026-10-28' });
  assert.deepEqual(by['This year'], { from: '2026-01-01', to: '2026-10-28' });
  assert.notDeepEqual(by['12 months'], by['This year']);
});
test('the calendar lets a preset start before the usual earliest date', () => {
  assert.equal(pickerMin('2026-05-02', '2025-10-29'), '2025-10-29');
  assert.equal(pickerMin('2026-05-02', '2026-06-01'), '2026-01-01');
});
test('continuing a shortened statement starts the day after it ended, across month and year ends', () => {
  assert.equal(dayAfter('2023-02-09'), '2023-02-10');
  assert.equal(dayAfter('2023-02-28'), '2023-03-01');
  assert.equal(dayAfter('2024-12-31'), '2025-01-01');
  assert.equal(dayAfter('2024-02-28'), '2024-02-29');
});
test('day counts are inclusive', () => {
  assert.equal(daysBetween('2026-10-28', '2026-10-28'), 1);
  assert.equal(daysBetween('2026-10-01', '2026-10-28'), 28);
});
test('API errors keep their code, and server errors keep their reference', () => {
  assert.deepEqual(parseApiError(404, { code: 'USER_NOT_FOUND', message: 'x' }), { code: 'USER_NOT_FOUND', message: 'x', ref: undefined });
  const server = parseApiError(500, { error: 'Something went wrong (ref: 23f97212-6e72-4ff2-98b8-6e832af1dfcf)' });
  assert.equal(server.code, 'SERVER'); assert.equal(server.ref, '23f97212-6e72-4ff2-98b8-6e832af1dfcf');
  assert.equal(parseApiError(400, { error: 'Invalid request', issues: [{ path: ['from'], message: 'Invalid' }] }).message, 'from: Invalid');
  assert.equal(parseApiError(502, null).code, 'SERVER');
});

