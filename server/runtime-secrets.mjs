const allowed = new Set([
  'OPENAI_API_KEY',
  'OPENAI_APIKEY',
  'ANTHROPIC_API_KEY',
  'DUFFEL_ACCESS_TOKEN',
  'OPEN_METEO_API_KEY',
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_LOGIN_CHANNEL_ID',
  'LINE_LIFF_ID',
  'LINE_BOT_BASIC_ID',
  'LIFF_ID',
  'LINE_CHANNEL_ID',
  'LINE_ACCESS_TOKEN',
]);
let loaded;
export function loadSecrets() {
  if (!process.env.BOP_RUNTIME_SECRET_ID) return;
  loaded ??= (async () => {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const { SecretString } = await new SecretsManagerClient({}).send(
      new GetSecretValueCommand({ SecretId: process.env.BOP_RUNTIME_SECRET_ID }),
    );
    for (const [name, value] of Object.entries(JSON.parse(SecretString))) {
      if (allowed.has(name) && !process.env[name] && typeof value === 'string' && value.trim())
        process.env[name] = value;
    }
  })().catch((error) => {
    loaded = undefined;
    if (error.name === 'ResourceNotFoundException') return;
    throw error;
  });
  return loaded;
}
