import { Fragment, useState } from 'react';
import { Candidate } from '@/types/index';

interface CandidateTableProps {
  candidates: Candidate[];
  selectedIds: Set<string>;
  onToggleCandidate: (id: string) => void;
  onToggleByStrength: (strength: string) => void;
}

const TIER_STYLES: Record<string, string> = {
  excellent: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  strong: 'bg-alphanom-teal-soft text-alphanom-navy ring-1 ring-alphanom-teal/30',
  potential: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  low: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

const BAR_STYLES: Record<string, string> = {
  excellent: 'bg-emerald-500',
  strong: 'bg-alphanom-teal',
  potential: 'bg-amber-400',
  low: 'bg-slate-300',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export default function CandidateTable({
  candidates,
  selectedIds,
  onToggleCandidate,
}: CandidateTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (candidates.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-alphanom-line px-6 py-14 text-center">
        <p className="font-jakarta font-semibold text-alphanom-navy">No candidates in this view</p>
        <p className="mt-1 text-sm text-alphanom-muted">
          Enable more match strengths above to widen the shortlist.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-2 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-alphanom-bg">
            <th className="w-12 rounded-l-card border-y border-l border-alphanom-line py-3 pl-4" />
            <th className="w-14 border-y border-alphanom-line py-3 text-left section-label">#</th>
            <th className="border-y border-alphanom-line py-3 pl-1 text-left section-label">Candidate</th>
            <th className="border-y border-alphanom-line py-3 text-left section-label">Organization</th>
            <th className="w-44 border-y border-alphanom-line py-3 text-left section-label">Match</th>
            <th className="w-28 rounded-r-card border-y border-r border-alphanom-line py-3 pr-4 text-right section-label">
              Profile
            </th>
          </tr>
        </thead>

        <tbody>
          {candidates.map((candidate, index) => {
            const isOpen = expandedId === candidate.id;
            const score = Math.round(candidate.finalScore);

            return (
              <Fragment key={candidate.id}>
                <tr
                  className={`group border-b border-alphanom-line/70 transition-colors ${
                    isOpen ? 'bg-alphanom-teal-soft/40' : 'hover:bg-alphanom-bg/70'
                  }`}
                >
                  <td className="py-3 pl-4 align-middle">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(candidate.id)}
                      onChange={() => onToggleCandidate(candidate.id)}
                      aria-label={`Select ${candidate.name}`}
                      className="h-4 w-4 cursor-pointer rounded border-alphanom-line accent-alphanom-teal"
                    />
                  </td>

                  <td className="py-3 align-middle font-mono text-xs text-alphanom-muted">
                    {String(index + 1).padStart(2, '0')}
                  </td>

                  <td className="py-3 pl-1 pr-4 align-middle">
                    <button
                      onClick={() => setExpandedId(isOpen ? null : candidate.id)}
                      className="flex w-full items-center gap-3 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="avatar">{initials(candidate.name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-jakarta font-semibold text-alphanom-navy group-hover:text-alphanom-teal">
                          {candidate.name}
                        </span>
                        <span className="block truncate text-xs text-alphanom-muted">
                          {candidate.currentDesignation || 'Designation not listed'}
                        </span>
                      </span>
                    </button>
                  </td>

                  <td className="py-3 pr-4 align-middle">
                    <span className="block truncate text-alphanom-navy/80">
                      {candidate.currentOrganization || '—'}
                    </span>
                    {candidate.location && (
                      <span className="block truncate text-xs text-alphanom-muted">
                        {candidate.location}
                      </span>
                    )}
                  </td>

                  <td className="py-3 pr-4 align-middle">
                    <div className="flex items-center gap-2.5">
                      <span className="font-jakarta text-sm font-bold tabular-nums text-alphanom-navy">
                        {score}
                      </span>
                      <span className="h-1.5 w-16 overflow-hidden rounded-pill bg-alphanom-line">
                        <span
                          className={`block h-full rounded-pill ${BAR_STYLES[candidate.matchStrength]}`}
                          style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
                        />
                      </span>
                      <span className={`badge ${TIER_STYLES[candidate.matchStrength]}`}>
                        {candidate.matchStrength}
                      </span>
                    </div>
                  </td>

                  <td className="py-3 pr-4 text-right align-middle">
                    <a
                      href={candidate.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-pill border border-alphanom-line px-3 py-1.5 text-xs font-semibold text-alphanom-teal transition-colors hover:border-alphanom-teal hover:bg-alphanom-teal-soft"
                    >
                      View ↗
                    </a>
                  </td>
                </tr>

                {isOpen && (
                  <tr className="border-b border-alphanom-line bg-alphanom-bg/60">
                    <td colSpan={6} className="px-4 py-5">
                      <div className="grid gap-5 md:grid-cols-3">
                        <div className="md:col-span-3">
                          <h4 className="section-label mb-1.5">Why this ranking</h4>
                          <p className="text-sm leading-relaxed text-alphanom-navy/80">
                            {candidate.reasoningSummary ||
                              'No AI narrative available for this candidate.'}
                          </p>
                          {/*
                            Only the top handful of candidates reach AI review;
                            on a live run 118 of 137 carried no narrative at all
                            and this panel was effectively blank for them. Every
                            candidate does carry relevanceReason -- the stated
                            grounds for the ranking, already computed and stored
                            -- which was never shown anywhere.
                          */}
                          {candidate.relevanceReason && (
                            <p className="mt-2 text-sm leading-relaxed text-alphanom-muted">
                              {candidate.relevanceReason}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-4 text-xs text-alphanom-muted">
                            <span>
                              Profile signals{' '}
                              <strong className="font-jakarta text-alphanom-navy">
                                {Math.round(candidate.deterministicScore)}
                              </strong>
                            </span>
                            <span>
                              AI assessment{' '}
                              <strong className="font-jakarta text-alphanom-navy">
                                {Math.round(candidate.contextualScore)}
                              </strong>
                            </span>
                            <span>
                              Found via{' '}
                              <strong className="font-jakarta text-alphanom-navy">
                                {candidate.queryFamilies.length}
                              </strong>{' '}
                              search angle{candidate.queryFamilies.length === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>

                        <EvidenceList
                          title="Confirmed"
                          tone="text-emerald-700"
                          items={candidate.confirmedMatches}
                        />
                        <EvidenceList
                          title="Uncertain"
                          tone="text-amber-700"
                          items={candidate.uncertainRequirements}
                        />
                        <EvidenceList
                          title="Concerns"
                          tone="text-rose-700"
                          items={candidate.mismatchFlags}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-card border border-alphanom-line bg-white p-3.5">
      <h5 className={`section-label mb-2 ${tone}`}>{title}</h5>
      <ul className="space-y-1.5 text-sm text-alphanom-navy/80">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-alphanom-muted">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
