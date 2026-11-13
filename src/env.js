// Reads ./.env without printing anything. Values already set in the real environment win.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = path.join(ROOT, '.env')) {
  const fromFile = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue;
      const key = line.slice(0, line.indexOf('=')).trim();
      fromFile[key] = line.slice(line.indexOf('=') + 1).trim();
    }
  }
  const merged = { ...fromFile };
  for (const key of Object.keys(fromFile)) if (process.env[key]) merged[key] = process.env[key];
  for (const key of ['FUNDING', 'AGENT', 'PORT', 'DEEPSEEK_MODEL', 'DEEPSEEK_API_KEY', 'IDLE_RESET_MINUTES', 'AERODATABOX_KEY']) {
    if (process.env[key]) merged[key] = process.env[key];
  }
  return merged;
}
