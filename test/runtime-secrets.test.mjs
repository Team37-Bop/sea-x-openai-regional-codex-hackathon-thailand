import assert from 'node:assert/strict';
import test from 'node:test';
import { isMissingCurrentVersion, loadRuntimeSecrets } from '../server/runtime-secrets.mjs';

test('runtime configuration keeps existing values and accepts only supported provider and integration fields', async () => {
  const target = { OPENAI_API_KEY: 'process-override' };
  const values = {
    OPENAI_API_KEY: 'fixture-key',
    LINE_CHANNEL_SECRET: 'fixture-channel',
    DUFFEL_ACCESS_TOKEN: 'fixture-supplier',
    BOP_FLIGHT_BOOKING: '1',
    NODE_OPTIONS: 'ignored',
  };
  await loadRuntimeSecrets({ secretId: 'fixture', fetchSecret: async () => JSON.stringify(values), target });
  assert.deepEqual(target, {
    OPENAI_API_KEY: 'process-override',
    LINE_CHANNEL_SECRET: 'fixture-channel',
    DUFFEL_ACCESS_TOKEN: 'fixture-supplier',
  });
});

test('a missing current version is distinguishable from an inaccessible secret', async () => {
  assert.equal(isMissingCurrentVersion({
    name: 'ResourceNotFoundException',
    message: 'specified secret value for staging label: AWSCURRENT',
  }), true);
  assert.equal(isMissingCurrentVersion({ name: 'ResourceNotFoundException', message: 'Secret not found' }), false);
  const error = Object.assign(new Error('fixture'), { name: 'AccessDeniedException' });
  await assert.rejects(loadRuntimeSecrets({ secretId: 'fixture', fetchSecret: async () => { throw error; } }), error);
});
