/**
 * Settings for the example, read from `.env` (git-ignored) and the environment.
 *
 * The server secret is read ONLY from here. It never appears in code, logs or answers,
 * and it must never reach an app or a browser.
 */
import fs from 'fs';
import path from 'path';
import { RiviumStorage } from '@rivium/storage-node';

/** Loads KEY=value lines from Example/.env into process.env (values already set in the environment win). */
function loadDotEnv(): void {
  const file = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export class SetupError extends Error {}

export interface ExampleEnv {
  apiKey: string;
  serverSecret: string;
  port: number;
  host: string;
  corsOrigins: string[];
  publicBucket: string;
  privateBucket: string;
  privateBucketMaxSize: number;
  authUrl?: string;
  /**
   * Host names / addresses (no port) the server answers to besides localhost, 127.0.0.1, [::1] and 10.0.2.2
   * (Android emulator): e.g. this computer's LAN address when a phone calls it. Any other `Host` header gets a 403,
   * so a web page can't reach the server through a DNS name it controls (DNS rebinding).
   */
  allowedHosts: string[];
  /** When set, every POST must carry `x-demo-token: <this>`. */
  demoToken?: string;
}

const PLACEHOLDER = /YOUR_/;

/** Reads and checks the settings. Throws SetupError with the exact fix when something is missing. */
export function readEnv(): ExampleEnv {
  loadDotEnv();
  const problems: string[] = [];

  const apiKey = (process.env.RIVIUM_API_KEY || '').trim();
  const serverSecret = (process.env.RIVIUM_SERVER_SECRET || '').trim();

  if (!apiKey || PLACEHOLDER.test(apiKey)) {
    problems.push('RIVIUM_API_KEY is not set (your public key, rv_live_... - Console > your project > API keys).');
  } else if (!/^rv_(live|test)_/.test(apiKey)) {
    problems.push('RIVIUM_API_KEY should start with rv_live_ or rv_test_.');
  }
  if (!serverSecret || PLACEHOLDER.test(serverSecret)) {
    problems.push('RIVIUM_SERVER_SECRET is not set (rv_srv_... - Console > your project > API keys > Server secret).');
  } else if (!serverSecret.startsWith('rv_srv_')) {
    problems.push('RIVIUM_SERVER_SECRET should start with rv_srv_.');
  }

  if (problems.length) {
    throw new SetupError(
      [
        'Setup needed:',
        ...problems.map((p) => `  - ${p}`),
        '',
        'Fix: cp .env.example .env   then put your keys in .env (it is git-ignored).',
      ].join('\n'),
    );
  }

  const maxSize = Number(process.env.PRIVATE_BUCKET_MAX_SIZE || 1048576);

  return {
    apiKey,
    serverSecret,
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    corsOrigins: (process.env.CORS_ORIGINS ||
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://localhost:8081')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    publicBucket: process.env.PUBLIC_BUCKET || 'rivium-example-public',
    privateBucket: process.env.PRIVATE_BUCKET || 'rivium-example-private-images',
    privateBucketMaxSize: Number.isFinite(maxSize) && maxSize > 0 ? maxSize : 1048576,
    authUrl: process.env.RIVIUM_AUTH_URL || undefined,
    allowedHosts: (process.env.ALLOWED_HOSTS || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    demoToken: (process.env.DEMO_TOKEN || '').trim() || undefined,
  };
}

/** The server instance: public key + server secret. Skips access rules; can manage buckets, rules, links, tokens. */
export function serverStorage(env: ExampleEnv): RiviumStorage {
  return new RiviumStorage({
    apiKey: env.apiKey,
    serverSecret: env.serverSecret,
    authUrl: env.authUrl,
    timeout: 30000,
  });
}

/** Address of the Storage API. The SDK has it built in; the example needs it for the few raw calls (see SDK gaps). */
export const STORAGE_API = 'https://storage.rivium.co';
