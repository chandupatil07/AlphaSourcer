'use client';

import { useMemo } from 'react';
import { Candidate, SearchBrief, SearchSession } from '@/types/index';
import { buildBriefCoverage, CoverageRow } from '@/lib/candidates/briefCoverage';

/**
 * Reports, for the list actually on screen, how far each thing the
 * requirement asked for was met.
 *
 * Deliberately three states rather than a single percentage: proven, visible,
 * and not evidenced. A search snippet is around 160 characters and usually
 * names no skills at all, so collapsing "we could not check" into "does not
 * have it" would overstate the failure exactly as badly as ignoring it would
 * overstate the success.
 */
const KIND_LABEL: Record<CoverageRow['kind'], string> = {
  title: 'Job title',
  location: 'Location',
  skill: 'Must-have skill',
  experience: 'Experience',
};

function Bar({ row }: { row: CoverageRow }) {
  const pct = (n: number) => (row.total > 0 ? (n / row.total) * 100 : 0);
  const segments = [
    { n: row.confirmed, className: 'bg-alphanom-teal', title: 'Proven by the search that found them' },
    { n: row.visible, className: 'bg-alphanom-teal/45', title: 'Visible in the profile text' },
    { n: row.contradicted, className: 'bg-rose-400', title: 'Contradicted by the profile' },
    { n: row.unknown, className: 'bg-alphanom-line', title: 'Not evidenced either way' },
  ].filter((s) => s.n > 0);

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-pill bg-alphanom-line">
      {segments.map((s) => (
        <div
          key={s.className}
          className={s.className}
          style={{ width: `${pct(s.n)}%` }}
          title={`${s.n} — ${s.title}`}
        />
      ))}
    </div>
  );
}

export default function RequirementCoverage({
  candidates,
  brief,
  verification,
}: {
  candidates: Candidate[];
  brief: SearchBrief | null;
  verification?: SearchSession['skillVerification'];
}) {
  const coverage = useMemo(() => buildBriefCoverage(candidates, brief), [candidates, brief]);

  if (!coverage || coverage.rows.length === 0) return null;

  const skillRows = coverage.rows.filter((r) => r.kind === 'skill');

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-jakarta text-lg font-bold text-alphanom-navy">
          Did this deliver what you asked for?
        </h3>
        <span className="text-xs text-alphanom-muted">
          across the {coverage.total} candidate{coverage.total === 1 ? '' : 's'} shortlisted
        </span>
      </div>

      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-alphanom-muted">
        Each line is something your requirement asked for, and how much of the shortlist actually
        evidences it. A blank bar is not a failed candidate — it is a profile whose public snippet
        never mentioned the thing either way.
      </p>

      <ul className="mt-5 space-y-4">
        {coverage.rows.map((row) => {
          const evidenced = row.confirmed + row.visible;
          return (
            <li key={row.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-jakarta text-sm font-semibold text-alphanom-navy">
                    {row.requirement}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-alphanom-muted">
                    {KIND_LABEL[row.kind]}
                  </span>
                </div>
                <span className="font-jakarta text-sm font-semibold tabular-nums text-alphanom-navy">
                  {evidenced}
                  <span className="font-normal text-alphanom-muted"> / {row.total}</span>
                </span>
              </div>

              <div className="mt-2">
                <Bar row={row} />
              </div>

              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-alphanom-muted">
                {row.confirmed > 0 && <span>{row.confirmed} proven by search</span>}
                {row.visible > 0 && <span>{row.visible} visible in profile</span>}
                {row.contradicted > 0 && (
                  <span className="font-medium text-rose-600">
                    {row.contradicted} {row.kind === 'skill' ? 'checked, not there' : 'contradicted'}
                  </span>
                )}
                {row.unknown > 0 && <span>{row.unknown} not evidenced</span>}
              </div>

              <p className="mt-1 text-xs leading-relaxed text-alphanom-muted/90">{row.note}</p>
            </li>
          );
        })}
      </ul>

      {skillRows.length > 1 && (
        <div className="mt-5 flex flex-wrap items-baseline gap-x-2 border-t border-alphanom-line pt-4 text-sm">
          <span className="font-jakarta font-semibold text-alphanom-navy">
            {coverage.allSkills}
          </span>
          <span className="text-alphanom-muted">
            of {coverage.total} evidence <strong className="font-medium text-alphanom-navy">all
            {' '}{skillRows.length}</strong> required skills at once.
          </span>
        </div>
      )}

      {verification && verification.probes > 0 && (
        <p className="mt-5 rounded-card border border-alphanom-line bg-white px-4 py-3 text-xs leading-relaxed text-alphanom-muted">
          <strong className="font-jakarta font-semibold text-alphanom-navy">
            {verification.probes} profiles were checked one by one.
          </strong>{' '}
          Each check asked Google whether one named profile carries one named skill, at one search
          credit each. {verification.confirmed} came back confirmed and {verification.absent} came
          back without the skill on the page.
          {verification.failed > 0
            ? ` ${verification.failed} could not be reached and are still counted as untested, not as missing.`
            : ''}
        </p>
      )}

      {coverage.thinSkillEvidence && (
        <p className="mt-4 rounded-card bg-alphanom-bg px-4 py-3 text-xs leading-relaxed text-alphanom-muted">
          <strong className="font-jakarta font-semibold text-alphanom-navy">
            Why so many bars are mostly empty:
          </strong>{' '}
          a public search result is about 160 characters of name, headline and city, and it
          usually lists no skills at all. Everything grey above is untested, not missing. Naming a
          skill in the requirement makes the search demand it directly, which is what turns grey
          into the darker &ldquo;proven&rdquo; band.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-alphanom-line pt-4 text-[11px] text-alphanom-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-pill bg-alphanom-teal" /> proven by the search
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-pill bg-alphanom-teal/45" /> visible in the profile
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-pill bg-rose-400" /> contradicted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-pill bg-alphanom-line" /> not evidenced either way
        </span>
      </div>
    </section>
  );
}
