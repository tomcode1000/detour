import { createStandinAgent } from './standin.js';
import { createDeepseekAgent } from './deepseek.js';

// Uses DeepSeek when DEEPSEEK_API_KEY is set (and AGENT is not "standin"); otherwise the stand-in.
export function createAgent({ env }) {
  const standin = createStandinAgent();
  if (env.AGENT === 'standin' || !env.DEEPSEEK_API_KEY) return standin;
  return createDeepseekAgent({ env, fallback: standin });
}
