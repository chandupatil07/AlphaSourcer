export type ModelSpec = {
  id: string;
  /**
   * Scales max_tokens for this model. Reasoning-heavy models spend a large
   * share of the completion budget before emitting any JSON, so a cap tuned
   * for one model truncates another mid-object.
   */
  tokenMultiplier: number;
};

/**
 * Tried in order. Groq meters rate limits per model, so falling through is not
 * only resilience against a decommissioned or failing model — it also unlocks a
 * fresh token budget when one model is exhausted.
 *
 * Deliberately excludes groq/compound*, which routes to gpt-oss-120b internally
 * and therefore shares its quota.
 */
const DEFAULT_CHAIN: ModelSpec[] = [
  { id: 'openai/gpt-oss-120b', tokenMultiplier: 1 },
  { id: 'openai/gpt-oss-20b', tokenMultiplier: 1 },
  // { id: 'qwen/qwen3.6-27b', tokenMultiplier: 1.8 },  //original 
    { id: 'qwen/qwen3.8-27b', tokenMultiplier: 1.8 },  //new changed for testing
];

function parseChain(raw: string | undefined): ModelSpec[] | null {
  if (!raw) return null;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return null;
  return ids.map((id) => {
    const known = DEFAULT_CHAIN.find((m) => m.id === id);
    return { id, tokenMultiplier: known?.tokenMultiplier ?? 1.5 };
  });
}

/** GROQ_MODEL_CHAIN overrides the whole chain; GROQ_PRIMARY_MODEL just the head. */
export function getModelChain(): ModelSpec[] {
  const override = parseChain(process.env.GROQ_MODEL_CHAIN);
  if (override) return override;

  const primary = process.env.GROQ_PRIMARY_MODEL;
  if (!primary) return DEFAULT_CHAIN;

  const rest = DEFAULT_CHAIN.filter((m) => m.id !== primary);
  const head = DEFAULT_CHAIN.find((m) => m.id === primary) ?? {
    id: primary,
    tokenMultiplier: 1,
  };
  return [head, ...rest];
}

export const AI_MODELS = {
  primary: process.env.GROQ_PRIMARY_MODEL || DEFAULT_CHAIN[0].id,
  extraction: process.env.GROQ_EXTRACTION_MODEL || DEFAULT_CHAIN[0].id,
};

export const GROQ_CONFIG = {
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
};

export const SERPER_CONFIG = {
  apiKey: process.env.SERPER_API_KEY,
  baseURL: 'https://google.serper.dev',
};
