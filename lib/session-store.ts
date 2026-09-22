import { SearchSession } from '@/types/index';
import * as fs from 'fs/promises';
import * as path from 'path';

const SESSIONS_DIR = path.join(process.cwd(), '.sessions');
const TTL_SECONDS = 24 * 60 * 60;

/**
 * A stored session that cannot be parsed is treated as missing rather than
 * thrown. The API route answers a missing session with a clean 404 that the
 * client handles; an exception here becomes a 500 and the client polls a
 * dead session forever. The cause is still logged, so a corrupt write is
 * visible in the server logs instead of being swallowed.
 */
function parseSession(raw: string, sessionId: string): SearchSession | null {
  try {
    return JSON.parse(raw) as SearchSession;
  } catch (error) {
    console.error(`Session ${sessionId} is stored but unreadable:`, error);
    return null;
  }
}

export interface SessionStore {
  set(sessionId: string, session: SearchSession): Promise<void>;
  get(sessionId: string): Promise<SearchSession | null>;
  delete(sessionId: string): Promise<void>;
}

/**
 * Local development: sessions live on disk.
 * Not usable on serverless — the filesystem is read-only and each invocation
 * may land on a different instance.
 */
export class FileSessionStore implements SessionStore {
  private async ensureDir(): Promise<void> {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
  }

  async set(sessionId: string, session: SearchSession): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    // Written to a temporary file and renamed, because the pipeline saves the
    // session repeatedly while the client is polling it. A plain write is not
    // atomic: a poll landing mid-write reads a truncated file, which used to
    // surface as a 500 rather than as "still working".
    const tempPath = `${filePath}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(session), 'utf-8');
    await fs.rename(tempPath, filePath);
  }

  async get(sessionId: string): Promise<SearchSession | null> {
    try {
      const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
      return parseSession(await fs.readFile(filePath, 'utf-8'), sessionId);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await fs.unlink(path.join(SESSIONS_DIR, `${sessionId}.json`));
    } catch {
      /* already gone */
    }
  }
}

/**
 * Serverless: sessions live in Upstash Redis, shared across invocations.
 * Uses the REST API over plain fetch, so no extra dependency is required.
 */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  private async command(args: (string | number)[]): Promise<unknown> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Redis error ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as { result?: unknown; error?: string };
    if (body.error) throw new Error(`Redis error: ${body.error}`);
    return body.result;
  }

  async set(sessionId: string, session: SearchSession): Promise<void> {
    await this.command(['SET', `session:${sessionId}`, JSON.stringify(session), 'EX', TTL_SECONDS]);
  }

  async get(sessionId: string): Promise<SearchSession | null> {
    const result = await this.command(['GET', `session:${sessionId}`]);
    if (typeof result !== 'string') return null;
    return parseSession(result, sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    await this.command(['DEL', `session:${sessionId}`]);
  }
}

/**
 * Picks Redis when its credentials are present (production), otherwise falls
 * back to disk so local development needs no extra services.
 */
export function createSessionStore(): SessionStore {
  // Vercel injects different names depending on which integration created the
  // database: Vercel KV uses KV_REST_API_*, the Upstash marketplace uses
  // UPSTASH_REDIS_REST_*. Accept either rather than requiring a rename.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_REST_URL;

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_REST_TOKEN;

  if (url && token) return new RedisSessionStore(url, token);

  if (process.env.VERCEL) {
    // Name the Redis-ish variables that ARE present, so a naming mismatch is
    // obvious instead of looking like "nothing was configured".
    const seen = Object.keys(process.env)
      .filter((k) => /REDIS|KV_|UPSTASH/i.test(k))
      .sort();

    throw new Error(
      'No Redis credentials found. Expected UPSTASH_REDIS_REST_URL + ' +
        'UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN). ' +
        (seen.length
          ? `Redis-related variables present: ${seen.join(', ')}. ` +
            'If your database uses different names, map them in Project Settings.'
          : 'No Redis-related variables are set at all — connect a database under Storage, then redeploy.')
    );
  }

  return new FileSessionStore();
}
