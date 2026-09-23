'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Header from '@/components/Header';
import SearchProgress from '@/components/search/SearchProgress';
import CandidateResults from '@/components/candidates/CandidateResults';
import { SearchSession } from '@/types/index';

export default function SearchPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const [session, setSession] = useState<SearchSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let consecutiveFailures = 0;
    let delay = 1500;

    // A single blocked or slow poll used to end the search permanently. Tolerate
    // a run of failures and back off, so transient hiccups are survivable.
    const MAX_CONSECUTIVE_FAILURES = 5;
    const MAX_DELAY = 5000;

    const poll = async () => {
      if (cancelled) return;

      try {
        const response = await fetch(`/api/search?sessionId=${sessionId}`);

        // A missing session is a final answer, not a hiccup. Treating it as a
        // failed poll meant five retries and then "Lost connection to the
        // search. It may still be running" -- which is misleading for a
        // session that does not exist, and made the user wait ten seconds to
        // be told the wrong thing.
        if (response.status === 404) {
          setError('That search could not be found. It may have expired — start a new one.');
          setLoading(false);
          return;
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data: SearchSession = await response.json();
        if (cancelled) return;

        consecutiveFailures = 0;
        setSession(data);

        if (data.status !== 'completed' && data.status !== 'failed') {
          delay = Math.min(delay + 250, MAX_DELAY);
          setTimeout(poll, delay);
          return;
        }

        // Finished: pull the full record once, including the removed list the
        // export needs but polling deliberately skips.
        if (data.status === 'completed') {
          try {
            const complete = await fetch(`/api/search?sessionId=${sessionId}&full=1`);
            if (complete.ok && !cancelled) setSession(await complete.json());
          } catch {
            /* the slim record is still perfectly usable */
          }
        }

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        consecutiveFailures += 1;

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          setError(
            'Lost connection to the search. It may still be running — refresh to check.'
          );
          setLoading(false);
          return;
        }

        setTimeout(poll, Math.min(delay * 2, MAX_DELAY));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-alphanom-bg">
      <Header />

      <main className="container mx-auto px-4 py-12 max-w-6xl">
        {loading && !session && !error ? (
          <div className="mx-auto max-w-3xl">
            <div className="shimmer relative h-64 overflow-hidden rounded-card bg-white" />
          </div>
        ) : loading && session && session.status !== 'completed' && session.status !== 'failed' ? (
          <SearchProgress session={session} />
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-card p-6 text-red-800">
            {error}
          </div>
        ) : session?.status === 'failed' ? (
          <div className="bg-red-50 border border-red-200 rounded-card p-6 text-red-800">
            <h3 className="font-jakarta font-bold mb-2">Search Failed</h3>
            <p>{session.error || 'An unknown error occurred'}</p>
          </div>
        ) : session ? (
          <>
            {session.warning && (
              <div className="bg-amber-50 border border-amber-200 rounded-card p-4 mb-6 text-amber-900">
                {session.warning}
              </div>
            )}
            <CandidateResults session={session} />
          </>
        ) : null}
      </main>
    </div>
  );
}
