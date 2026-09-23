'use client';

import { useMemo, useState } from 'react';
import type { BriefQuality } from '@/lib/search/briefQuality';

export interface ClarifyOption {
  label: string;
  value: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  why: string;
  options: ClarifyOption[];
  allowCustom: boolean;
}

export interface AnalyzeResult {
  questions: ClarifyQuestion[];
  suggestedPrompt: string;
  understood: string[];
  previewQueries: string[];
  quality: BriefQuality;
}

interface RefinePanelProps {
  analysis: AnalyzeResult;
  onSearch: (extraDetail: string) => void;
  onUseSuggested: (prompt: string) => void;
  onCancel: () => void;
  loading: boolean;
}

/** Colours per verdict, kept in one place so the band and the meter agree. */
const VERDICT_STYLE = {
  ready: {
    band: 'border-emerald-200 bg-emerald-50',
    text: 'text-emerald-900',
    sub: 'text-emerald-800/80',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
  },
  workable: {
    band: 'border-amber-200 bg-amber-50',
    text: 'text-amber-900',
    sub: 'text-amber-800/80',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
  },
  unusable: {
    band: 'border-rose-200 bg-rose-50',
    text: 'text-rose-900',
    sub: 'text-rose-800/80',
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
  },
} as const;

export default function RefinePanel({
  analysis,
  onSearch,
  onUseSuggested,
  onCancel,
  loading,
}: RefinePanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const setAnswer = (id: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  // Answered questions become extra requirement text, in the order asked.
  const extraDetail = useMemo(
    () =>
      analysis.questions
        .map((q) => answers[q.id])
        .filter((v) => v && v.trim())
        .join('. '),
    [analysis.questions, answers]
  );

  const answeredCount = analysis.questions.filter((q) => answers[q.id]?.trim()).length;

  /**
   * The corrected wording, including anything answered above. The panel used
   * to show a rewrite fixed at parse time, so picking "Bangalore" from the
   * questions left the suggested prompt with no city in it -- the one place
   * the user is told "this is the phrasing that works" was the one place the
   * answers did not reach.
   */
  const correctedPrompt = useMemo(() => {
    const base = analysis.suggestedPrompt.trim();
    if (!extraDetail.trim()) return base;
    return `${base}\n\nAlso: ${extraDetail.trim()}.`;
  }, [analysis.suggestedPrompt, extraDetail]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(correctedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the text is on screen and selectable.
      setCopied(false);
    }
  };

  const quality = analysis.quality;
  const style = VERDICT_STYLE[quality.verdict];

  // A brief with nothing to search for should not spend a minute and ~36
  // Serper credits proving it. Answering any question, or taking the
  // suggested wording, clears the block.
  const blocked = quality.verdict === 'unusable' && !extraDetail.trim();

  const unanswered = quality.gaps.filter(
    (gap) => !analysis.questions.some((q) => q.id === gap.id && answers[q.id]?.trim())
  );

  return (
    <div className="space-y-4">
      {/* Readiness — the first thing on screen, because it decides what to do next. */}
      <div className={`rounded-card border p-5 sm:p-6 ${style.band}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} />
            <div>
              <h3 className={`font-jakarta text-lg font-bold ${style.text}`}>{quality.headline}</h3>
              <p className={`mt-1 max-w-xl text-sm leading-relaxed ${style.sub}`}>{quality.detail}</p>
            </div>
          </div>

          <div className="min-w-[8rem]">
            <div className="flex items-baseline justify-between gap-2">
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${style.sub}`}>
                Brief detail
              </span>
              <span className={`font-jakarta text-sm font-bold tabular-nums ${style.text}`}>
                {quality.completeness}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-white/70">
              <div
                className={`h-full rounded-pill transition-all ${style.bar}`}
                style={{ width: `${quality.completeness}%` }}
              />
            </div>
          </div>
        </div>

        {unanswered.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-black/5 pt-4">
            {unanswered.map((gap) => (
              <li key={gap.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
                <span
                  className={`badge ${
                    gap.severity === 'blocking'
                      ? 'bg-rose-100 text-rose-900'
                      : 'bg-white/70 text-alphanom-navy ring-1 ring-black/5'
                  }`}
                >
                  {gap.label}
                </span>
                <span className={`flex-1 basis-64 leading-relaxed ${style.sub}`}>
                  {gap.consequence}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* What was understood */}
      <div className="card p-5 sm:p-6">
        <h3 className="section-label mb-3">What I understood</h3>
        {analysis.understood.length === 0 ? (
          <p className="text-sm text-alphanom-muted">
            Nothing concrete could be extracted — the questions below matter more than usual.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {analysis.understood.map((line) => {
              const [label, ...rest] = line.split(': ');
              return (
                <li key={line} className="flex gap-2 text-sm">
                  <span className="w-36 shrink-0 text-alphanom-muted">{label}</span>
                  <span className="font-medium text-alphanom-navy">{rest.join(': ')}</span>
                </li>
              );
            })}
          </ul>
        )}

        {analysis.previewQueries.length > 0 && (
          <details className="mt-4 border-t border-alphanom-line pt-3">
            <summary className="cursor-pointer text-sm font-medium text-alphanom-teal">
              Preview the searches this will run
            </summary>
            <ul className="mt-2 space-y-1">
              {analysis.previewQueries.map((q) => (
                <li key={q} className="break-words font-mono text-[11px] text-alphanom-navy/70">
                  {q}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Gaps */}
      {analysis.questions.length > 0 && (
        <div className="card p-5 sm:p-6">
          <h3 className="font-jakarta text-lg font-bold text-alphanom-navy">
            {quality.verdict === 'unusable'
              ? 'Answer any one of these to continue'
              : 'A few details would sharpen this'}
          </h3>
          <p className="mt-1 text-sm text-alphanom-muted">
            {quality.verdict === 'unusable'
              ? 'The search needs something concrete to look for.'
              : 'Optional — skip anything that doesn’t apply.'}
          </p>

          <div className="mt-5 space-y-5">
            {analysis.questions.map((q) => (
              <div key={q.id}>
                <label className="block font-jakarta text-sm font-semibold text-alphanom-navy">
                  {q.question}
                </label>
                <p className="mt-0.5 text-xs text-alphanom-muted">{q.why}</p>

                {q.options.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.options.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => setAnswer(q.id, opt.value)}
                        className={`chip ${answers[q.id] === opt.value ? 'chip-on' : 'chip-off'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {q.allowCustom && (
                  <input
                    id={`clarify-${q.id}`}
                    type="text"
                    value={
                      q.options.some((o) => o.value === answers[q.id]) ? '' : answers[q.id] ?? ''
                    }
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder="Or type your own…"
                    className="input-field mt-2 py-2 text-sm"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Corrected wording */}
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="section-label">Suggested phrasing</h3>
          {extraDetail.trim() && (
            <span className="badge bg-alphanom-teal-soft text-alphanom-navy">
              Updated with your answers
            </span>
          )}
        </div>
        <p className="mb-3 mt-2 text-xs text-alphanom-muted">
          This is the shape that searches best — explicit title, location, experience and
          background.
        </p>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-card bg-alphanom-bg p-3 font-mono text-xs leading-relaxed text-alphanom-navy/80">
          {correctedPrompt}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onUseSuggested(correctedPrompt)}
            disabled={loading}
            className="btn-secondary py-2 text-sm"
          >
            Use this wording
          </button>
          <button
            type="button"
            onClick={copyPrompt}
            disabled={loading}
            className="btn-secondary py-2 text-sm"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={() => onSearch(extraDetail)}
          disabled={loading || blocked}
          className="btn-primary sm:flex-1"
          title={
            blocked
              ? 'Add a job title, a required skill or a target company first'
              : undefined
          }
        >
          {loading
            ? 'Starting…'
            : blocked
              ? 'Add a title, skill or company to search'
              : answeredCount > 0
                ? `Search with ${answeredCount} added detail${answeredCount === 1 ? '' : 's'}`
                : 'Search as-is'}
        </button>
        <button onClick={onCancel} disabled={loading} className="btn-secondary">
          Back to editing
        </button>
      </div>

      {blocked && (
        <p className="text-center text-xs text-alphanom-muted">
          A search costs about a minute and 30–40 search credits. This one would return whoever
          happens to be indexed, so it is held back rather than spent.
        </p>
      )}
    </div>
  );
}
