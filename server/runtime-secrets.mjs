// Loads server-only credentials from one Secrets Manager JSON document at runtime.
// Values never enter Terraform state or Web Function revision environment variables.
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const ALLOWED_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_APIKEY',
  'OPENAI_API_KEY',
  'OPEN_METEO_API_KEY',
  'DUFFEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_LOGIN_CHANNEL_ID',
  'LINE_LIFF_ID',
  'LINE_BOT_BASIC_ID',
  'LIFF_ID',
  'LINE_CHANNEL_ID',
  'LINE_ACCESS_TOKEN',
]);

export function isMissingCurrentVersion(error) {
  return error?.name === 'ResourceNotFoundException' &&
    /specified secret value for staging label: AWSCURRENT/i.test(error.message || '');
}

async function fetchFromSecretsManager(secretId) {
  const client = new SecretsManagerClient({});
  let response;
  try {
    response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  } catch (error) {
    // Terraform creates the secret container without a value so credentials never
    // enter state. Before the first operator sync, use sample mode instead of
    // failing Lambda initialization. Keep authorization and other service errors fatal.
    if (isMissingCurrentVersion(error)) {
      return '{}';
    }
    throw error;
  }
  if (!response.SecretString) throw new Error('runtime secret has no SecretString');
  return response.SecretString;
}

/**
 * Load only known application secret keys. Existing process values win, which keeps
 * local development and emergency overrides deterministic.
 */
export async function loadRuntimeSecrets({
  secretId = process.env.BOP_RUNTIME_SECRET_ID,
  fetchSecret = fetchFromSecretsManager,
  target = process.env,
} = {}) {
  if (!secretId) return [];
  const raw = await fetchSecret(secretId);
  let values;
  try { values = JSON.parse(raw); }
  catch { throw new Error('runtime secret must be a JSON object'); }
  if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error('runtime secret must be a JSON object');

  const loaded = [];
  for (const [key, value] of Object.entries(values)) {
    if (!ALLOWED_KEYS.has(key) || typeof value !== 'string' || !value) continue;
    if (target[key] === undefined || target[key] === '') target[key] = value;
    loaded.push(key);
  }
  return loaded;
}

export const runtimeSecretKeys = () => [...ALLOWED_KEYS].sort();
