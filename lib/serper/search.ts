import { SearchResult } from '@/types/index';
import { SERPER_CONFIG } from '@/config/models';

// Serper allows 5 requests per second. The pipeline fans out every query and
// every page at once -- 18 queries x 2 pages is 36 simultaneous requests --
// so roughly a third of a search was being rejected with 429 and silently
// dropped. The parallelism is deliberate (sequential paging blew past the
// serverless time limit), so the fix is to space the starts rather than to
// serialise them.
const MIN_INTERVAL_MS = 220; // ~4.5 req/s, comfortably under the limit
const MAX_RETRIES = 3;

let nextSlotAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reserves the next send slot. JavaScript is single-threaded, so claiming a
 * slot and advancing the cursor cannot interleave -- every caller gets its own
 * slot, spaced MIN_INTERVAL_MS apart, however many fire at once.
 */
async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const sendAt = Math.max(now, nextSlotAt);
  nextSlotAt = sendAt + MIN_INTERVAL_MS;
  if (sendAt > now) await sleep(sendAt - now);
}

function isRateLimit(message: string): boolean {
  return /rate limit|429|too many requests/i.test(message);
}

export async function serperSearch(query: string, page?: number): Promise<SearchResult[]> {
  if (!SERPER_CONFIG.apiKey) {
    throw new Error('SERPER_API_KEY not configured');
  }

  let lastError: Error | null = null;

  // A 429 costs no credit, so retrying is free. Backing off and trying again
  // recovers a page that would otherwise be lost from the candidate pool.
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForSlot();

    try {
      return await requestPage(query, page);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRateLimit(lastError.message) || attempt === MAX_RETRIES) break;
      // 300ms, 600ms, 1200ms
      await sleep(300 * 2 ** attempt);
    }
  }

  console.error('Serper search failed:', lastError?.message);
  throw lastError ?? new Error('Serper search failed');
}

async function requestPage(query: string, page?: number): Promise<SearchResult[]> {
  {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': SERPER_CONFIG.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        // Free Serper accounts reject num > 10; depth comes from paging instead.
        num: 10,
        type: 'search',
        ...(page && page > 1 ? { page } : {}),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Serper API error: ${error.message || error.error || 'Unknown error'}`);
    }

    const data = await response.json();
    const results = data.organic || [];

    return results.map((result: any) => ({
      title: result.title || '',
      url: result.link || '',
      snippet: result.snippet || '',
      subtitle: result.subtitle || '',
      position: result.position || 0,
    }));
  }
}

/**
 * Walks several result pages for one query. Free-tier Serper caps a single
 * response at 10 results, so paging is the only way to reach useful recall.
 */
export async function serperSearchPaged(
  query: string,
  pages: number
): Promise<SearchResult[]> {
  // Pages are fetched concurrently rather than in sequence. Sequential paging
  // made depth cost wall-clock time, which is the scarce resource on a
  // serverless function; in parallel, more pages cost only Serper credits.
  const requests = Array.from({ length: pages }, (_, i) =>
    serperSearch(query, i + 1)
  );

  const settled = await Promise.allSettled(requests);
  const collected: SearchResult[] = [];
  let firstError: unknown = null;

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') collected.push(...outcome.value);
    else if (!firstError) firstError = outcome.reason;
  }

  if (collected.length === 0 && firstError) throw firstError;
  return collected;
}

export function isLinkedInProfileUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (!hostname.includes('linkedin.com')) {
      return false;
    }

    const pathname = urlObj.pathname.toLowerCase();

    // Check for LinkedIn profile URL pattern: /in/username
    if (pathname.match(/^\/in\/[a-z0-9\-]+\/?$/)) {
      return true;
    }

    // Reject company pages, jobs, posts, groups
    if (pathname.includes('/company/') || pathname.includes('/jobs/') || pathname.includes('/feed/') || pathname.includes('/groups/')) {
      return false;
    }

    return false;
  } catch {
    return false;
  }
}

export function normalizeLinkedInUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove query parameters and trailing slash
    return `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
