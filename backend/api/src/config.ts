import { resolve } from 'node:path';

export interface Config {
  mode: 'local'; host: string; port: number; databasePath: string; uploadDir: string;
  publicBaseUrl: string; sessionSecret: string; devLoginCode: string;
  agentBaseUrl: string; agentServiceToken: string; internalAgentToken: string; schoolId: string;
  adminPhones: string[];
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${key}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = required(env, 'APP_MODE');
  if (mode !== 'local') throw new Error('This API only supports APP_MODE=local');
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const host = env.HOST?.trim() || '127.0.0.1';
  const sessionSecret = required(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32 || sessionSecret.startsWith('replace-')) throw new Error('SESSION_SECRET must be a random value of at least 32 characters');
  const devLoginCode = required(env, 'DEV_LOGIN_CODE');
  if (!/^\d{6}$/.test(devLoginCode)) throw new Error('DEV_LOGIN_CODE must be six digits');
  const agentServiceToken = required(env, 'AGENT_SERVICE_TOKEN');
  const internalAgentToken = required(env, 'INTERNAL_AGENT_TOKEN');
  if (agentServiceToken.startsWith('replace-') || internalAgentToken.startsWith('replace-') ||
    agentServiceToken.length < 24 || internalAgentToken.length < 24) throw new Error('Both service tokens must be random values of at least 24 characters');
  if (agentServiceToken === internalAgentToken) throw new Error('Agent service tokens must differ');
  const publicBaseUrl = required(env, 'PUBLIC_BASE_URL').replace(/\/$/, '');
  const agentBaseUrl = required(env, 'AGENT_BASE_URL').replace(/\/$/, '');
  for (const url of [publicBaseUrl, agentBaseUrl]) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid service URL');
  }
  return {
    mode: 'local', host, port,
    databasePath: resolve(required(env, 'DATABASE_PATH')),
    uploadDir: resolve(required(env, 'UPLOAD_DIR')),
    publicBaseUrl, sessionSecret, devLoginCode, agentBaseUrl, agentServiceToken, internalAgentToken,
    schoolId: env.AGENT_SCHOOL_ID?.trim() || 'school_demo',
    adminPhones: (env.ADMIN_PHONES ?? '').split(',').map(value => value.trim()).filter(value => /^1\d{10}$/.test(value))
  };
}
