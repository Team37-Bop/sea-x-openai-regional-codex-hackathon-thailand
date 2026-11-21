import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

const cliEnv = { ...process.env };
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE']) delete cliEnv[name];
export const cli = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path, 'claude')).find(path => {
  try { accessSync(path, constants.X_OK); return true; } catch { return false; }
});
let status;
let statusExpires = 0;

function execute(args, { cwd, input, signal, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd, env: cliEnv, stdio: ['pipe', 'pipe', 'pipe'], signal });
    let output = '';
    let err = '';
    let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk;
      if (output.length > 4_000_000) child.kill('SIGKILL');
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { if (err.length < 12_000) err += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (expired) reject(Object.assign(new Error('Bop ใช้เวลานานเกิน 180 วินาที'), { code: 'upstream' }));
      else resolve({ code, output, err });
    });
  });
}
export function loggedIn() {
  if (!cli) return Promise.resolve(false);
  if (statusExpires > Date.now()) return status;
  statusExpires = Date.now() + 60_000;
  status = execute(['auth', 'status', '--json'], { timeout: 5000 })
    .then(reply => JSON.parse(reply.output).loggedIn === true).catch(() => false);
  return status;
}
export async function subscription(prompt, model, searches, signal) {
  if (!await loggedIn()) throw Object.assign(new Error('Bop เชื่อมต่อบัญชีไม่ได้'), { code: 'auth' });
  const cwd = await mkdtemp(join(tmpdir(), 'bop-model-'));
  try {
    const mcp = join(cwd, 'empty-mcp.json');
    await writeFile(mcp, '{"mcpServers":{}}');
    const reply = await execute([
      '-p', '--output-format', 'stream-json', '--verbose', '--model', model,
      '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcp,
      '--tools', searches ? 'WebSearch' : '', '--max-turns', String(searches + 2),
    ], { cwd, input: prompt, signal, timeout: 180_000 });
    const events = reply.output.split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const result = events.findLast(event => event.type === 'result');
    if (reply.code !== 0 || result?.is_error) {
      const message = String(result?.result ?? reply.err);
      if (/rate limit|usage limit|quota/i.test(message)) throw Object.assign(new Error('Bop ใช้โควตาของวันนี้หมดแล้ว ลองใหม่ภายหลัง'), { code: 'rate_limit' });
      if (/not logged in|authentication|model not found|unauthorized/i.test(message)) throw Object.assign(new Error('Bop เชื่อมต่อบัญชีไม่ได้'), { code: 'auth' });
      throw Object.assign(new Error('Bop ติดต่อบริการจัดทริปไม่ได้'), { code: 'upstream' });
    }
    return {
      text: String(result?.result ?? ''),
      usage: result?.usage ?? {},
      urls: events.filter(event => event.type === 'user').flatMap(event => (event.message?.content ?? []).flatMap(block =>
        block.type === 'tool_result' ? (String(block.content).match(/https:\/\/[^\s"<>),\]]+/g) ?? []) : [])),
    };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
