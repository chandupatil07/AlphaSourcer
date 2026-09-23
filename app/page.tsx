'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import RequirementInput from '@/components/search/RequirementInput';
import AdvancedFilters from '@/components/search/AdvancedFilters';
import RefinePanel, { AnalyzeResult } from '@/components/search/RefinePanel';

/**
 * Each example is a complete brief: title, skills, experience and location.
 * A single example taught the shape for one role family only, so anyone
 * hiring outside engineering had nothing to copy.
 */
const EXAMPLES = [
  {
    chip: 'Senior Backend Engineer · Bangalore',
    text: 'Looking for a Senior Backend Engineer with 4–7 years of experience in Python, Django, AWS and microservices. Candidates should preferably have product startup experience. Location: Bangalore.',
  },
  {
    chip: 'Enterprise Sales · Mumbai',
    text: 'Looking for an Enterprise Sales Manager with 5–8 years of B2B SaaS sales experience, carrying an annual quota and selling to CIOs. Must have experience with Salesforce and outbound prospecting. Location: Mumbai.',
  },
  {
    chip: 'Data Scientist · Pune or Hyderabad',
    text: 'Looking for a Data Scientist with 3–6 years of experience in Python, SQL and machine learning, ideally with NLP exposure. Prefer candidates from product companies. Location: Pune or Hyderabad.',
  },
];

/** The real flow, in the order it happens. The middle step used to be left
 *  out, which made the review screen look like an interruption rather than
 *  the point. */
const STEPS = [
  { title: 'Describe the role', body: 'Paste a JD or write it in plain language.' },
  {
    title: 'Check what was understood',
    body: 'See the title, skills, experience and location it read — and fix them before anything runs.',
  },
  {
    title: 'Get a ranked shortlist',
    body: 'Scored and explained, with a note on how much of your brief each candidate actually evidences.',
  },
];

export default function Home() {
  const router = useRouter();
  const [requirement, setRequirement] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({});
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (!requirement.trim()) {
      setError('Please enter a hiring requirement');
      return;
    }

    setError('');
    setAnalyzing(true);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not analyse requirement');
      setAnalysis(data as AnalyzeResult);
    } catch (err) {
      // Previously this fell through to a full search. That spent roughly 36
      // search credits and a minute on a requirement nobody had reviewed, at
      // the exact moment the tool had just failed to understand it. Say so
      // and let the recruiter decide instead.
      console.error(err);
      setError(
        'Could not read that requirement. You can still search it as written, or edit it and try again.'
      );
      setAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const runSearch = async (extraDetail: string) => {
    const finalRequirement = extraDetail.trim()
      ? `${requirement.trim()}

Additional requirements: ${extraDetail.trim()}`
      : requirement.trim();

    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: finalRequirement, advancedFilters }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed');

      router.push(`/search/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-alphanom-bg">
      <Header />

      <main className="container mx-auto max-w-4xl px-4 pb-20 pt-10 sm:pt-14">
        <section className="text-center">
          <span className="inline-flex items-center gap-2 rounded-pill border border-alphanom-line bg-white px-3.5 py-1.5 text-xs font-semibold text-alphanom-muted shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-alphanom-teal" />
            Sourcing agent
          </span>

          <h1 className="mt-5 font-jakarta text-4xl font-bold leading-tight text-alphanom-navy sm:text-5xl">
            Find the right candidates.
            <br />
            <span className="bg-gradient-to-r from-alphanom-navy via-alphanom-navy-soft to-alphanom-teal bg-clip-text text-transparent">
              Let AI handle the sourcing.
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-alphanom-muted sm:text-lg">
            Describe who you&rsquo;re looking for. AlphaSourcer builds the search strategy, runs
            intelligent X-ray searches, and ranks the most relevant candidates.
          </p>
        </section>

        {analysis ? (
          <div className="mt-9">
            <RefinePanel
              analysis={analysis}
              loading={loading}
              onSearch={(extra) => runSearch(extra)}
              onUseSuggested={(prompt) => {
                setRequirement(prompt);
                setAnalysis(null);
              }}
              onCancel={() => setAnalysis(null)}
            />
          </div>
        ) : (
        <section className="card card-lift mt-9 p-6 sm:p-8">
          <RequirementInput
            value={requirement}
            onChange={setRequirement}
            onSubmitShortcut={handleAnalyze}
            loading={loading || analyzing}
            onSearch={handleAnalyze}
          />

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-alphanom-line pt-4">
            <span className="section-label">Try</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.chip}
                type="button"
                onClick={() => setRequirement(example.text)}
                disabled={loading}
                className="rounded-pill border border-alphanom-line px-3 py-1.5 text-xs font-medium text-alphanom-muted transition-colors hover:border-alphanom-teal hover:bg-alphanom-teal-soft hover:text-alphanom-navy disabled:opacity-50"
              >
                {example.chip}
              </button>
            ))}
          </div>
        </section>
        )}

        {error && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <span>{error}</span>
            {/* An error with no way forward is a dead end. The requirement is
                still in the box, so offer the one action that makes sense. */}
            {requirement.trim() && !loading && (
              <button
                type="button"
                onClick={() => runSearch('')}
                className="shrink-0 rounded-pill border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 transition-colors hover:bg-rose-100"
              >
                Search it as written
              </button>
            )}
          </div>
        )}

        <section className="card mt-4 p-5 sm:p-6">
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            aria-expanded={advancedOpen}
            className="flex w-full items-center justify-between gap-2 text-left font-jakarta font-semibold text-alphanom-navy"
          >
            <span>Add more requirements</span>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full bg-alphanom-bg text-alphanom-muted transition-transform ${
                advancedOpen ? 'rotate-45' : ''
              }`}
            >
              +
            </span>
          </button>

          {advancedOpen && (
            <div className="mt-4 border-t border-alphanom-line pt-4">
              <AdvancedFilters filters={advancedFilters} onChange={setAdvancedFilters} />
            </div>
          )}
        </section>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card p-5">
              <span className="font-mono text-xs font-semibold text-alphanom-teal">
                0{i + 1}
              </span>
              <h3 className="mt-2 font-jakarta text-base font-bold text-alphanom-navy">
                {step.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-alphanom-muted">{step.body}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
