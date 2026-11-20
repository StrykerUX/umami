/**
 * Runs the Aurora end-to-end suite:
 *   1. applies migrations to DATABASE_URL
 *   2. starts the app (production build if present, `next dev` otherwise) on AURORA_E2E_PORT
 *   3. runs vitest -c vitest.aurora-e2e.config.ts
 * Requires DATABASE_URL (a disposable database!) and APP_SECRET.
 */
import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import 'dotenv/config';

const port = process.env.AURORA_E2E_PORT || '3100';
const url = `http://localhost:${port}`;
const cronSecret = process.env.AURORA_CRON_SECRET || 'e2e-cron-secret-0123456789';
const env = {
  ...process.env,
  PORT: port,
  APP_URL: url,
  AURORA_CRON_SECRET: cronSecret,
  AURORA_MAIL_DRIVER: 'outbox',
  AURORA_E2E_URL: url,
  CI: '1',
  NEXT_TELEMETRY_DISABLED: '1',
};

async function waitFor(target: string, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(target);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${target}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env });

  const prod = existsSync('.next/BUILD_ID') && process.env.AURORA_E2E_DEV !== '1';
  const server: ChildProcess = spawn(
    'npx',
    prod ? ['next', 'start', '-p', port] : ['next', 'dev', '-p', port],
    {
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    },
  );

  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid, 'SIGTERM');
    } catch {}
  };
  process.on('exit', stop);

  try {
    await waitFor(`${url}/api/heartbeat`);
    // Warm the routes once in dev mode so compilation does not eat test timeouts.
    if (!prod) await fetch(`${url}/login`).catch(() => {});
    execSync('npx vitest run -c vitest.aurora-e2e.config.ts', { stdio: 'inherit', env });
  } finally {
    stop();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
