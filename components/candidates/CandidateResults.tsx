'use client';

import { useState } from 'react';
import { SearchSession } from '@/types/index';
import CandidateTable from './CandidateTable';
import CandidateFilters from './CandidateFilters';
import ExportButton from './ExportButton';
import RequirementCoverage from './RequirementCoverage';

export default function CandidateResults({ session }: { session: SearchSession }) {
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<string[]>(['excellent', 'strong', 'potential']);
  const [sortBy, setSortBy] = useState<'relevance' | 'name'>('relevance');

  const countOf = (tier: string) =>
    session.candidates.filter((c) => c.matchStrength === tier).length;

  const excellentMatches = countOf('excellent');
  const strongMatches = countOf('strong');
  const potentialMatches = countOf('potential');
  const lowMatches = countOf('low');

  const filteredCandidates = session.candidates.filter((c) => filters.includes(c.matchStrength));

  const sortedCandidates = [...filteredCandidates].sort((a, b) =>
    sortBy === 'relevance' ? b.finalScore - a.finalScore : a.name.localeCompare(b.name)
  );

  const toggleCandidate = (id: string) => {
    const next = new Set(selectedCandidates);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCandidates(next);
  };

  const toggleSelectAll = () => {
    // Acts on the rows currently on screen only. Comparing the whole set
    // against the visible count went wrong as soon as a filter hid a
    // selected candidate: the box read unchecked with everything visible
    // ticked, and clearing it wiped picks the recruiter could not see.
    const next = new Set(selectedCandidates);
    const allVisibleSelected =
      sortedCandidates.length > 0 && sortedCandidates.every((c) => next.has(c.id));
    sortedCandidates.forEach((c) => (allVisibleSelected ? next.delete(c.id) : next.add(c.id)));
    setSelectedCandidates(next);
  };

  const toggleSelectByStrength = (strength: string) => {
    const group = sortedCandidates.filter((c) => c.matchStrength === strength);
    const next = new Set(selectedCandidates);
    const allSelected = group.every((c) => next.has(c.id));
    group.forEach((c) => (allSelected ? next.delete(c.id) : next.add(c.id)));
    setSelectedCandidates(next);
  };

  const selectedCandidatesList = sortedCandidates.filter((c) => selectedCandidates.has(c.id));
  // The highest score actually shown. This read candidates[0], which is the
  // order the pipeline stored (relevance first); the table re-sorts by
  // finalScore, so the banner named one candidate while the list opened with
  // another -- "top match 75" above a first row scoring 98.
  const topScore =
    session.candidates.length > 0
      ? Math.round(Math.max(...session.candidates.map((c) => c.finalScore)))
      : 0;

  const stats = [
    { key: 'excellent', label: 'Excellent', value: excellentMatches },
    { key: 'strong', label: 'Strong', value: strongMatches },
    { key: 'potential', label: 'Potential', value: potentialMatches },
    { key: 'low', label: 'Low', value: lowMatches },
  ];

  return (
    <div className="space-y-6">
      {/* The requirement this shortlist answers, kept visible for context. */}
      {session.rawRequirement && (
        <details className="card p-5 sm:p-6" open>
          <summary className="cursor-pointer list-none">
            <span className="section-label">Your requirement</span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-alphanom-navy/80">
            {session.rawRequirement}
          </p>
          {session.searchBrief && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-alphanom-line pt-3">
              {session.searchBrief.primaryTitle && (
                <span className="badge bg-alphanom-teal-soft text-alphanom-navy">
                  {session.searchBrief.primaryTitle}
                </span>
              )}
              {session.searchBrief.locations.map((loc) => (
                <span key={loc} className="badge bg-alphanom-bg text-alphanom-muted ring-1 ring-alphanom-line">
                  {loc}
                </span>
              ))}
              {(session.searchBrief.minExperience !== null ||
                session.searchBrief.maxExperience !== null) && (
                <span className="badge bg-alphanom-bg text-alphanom-muted ring-1 ring-alphanom-line">
                  {session.searchBrief.minExperience ?? 0}–
                  {session.searchBrief.maxExperience ?? 'any'} yrs
                </span>
              )}
              {session.searchBrief.preferredCompanies.slice(0, 6).map((c) => (
                <span key={c} className="badge bg-alphanom-bg text-alphanom-muted ring-1 ring-alphanom-line">
                  {c}
                </span>
              ))}
            </div>
          )}
        </details>
      )}

      <div className="overflow-hidden rounded-card bg-brand-gradient shadow-lift">
        <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="section-label text-white/60">Sourcing complete</p>
            <h2 className="mt-1 font-jakarta text-3xl font-bold text-white sm:text-4xl">
              {session.uniqueCandidatesFound}{' '}
              <span className="text-white/80">candidates found</span>
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {session.searchBrief?.primaryTitle
                ? `Ranked for ${session.searchBrief.primaryTitle}`
                : 'Ranked by relevance'}
              {' · '}
              {session.generatedQueries.length} search angles
              {' · '}
              {session.totalResultsFound} profiles reviewed
              {session.totalUniqueBeforeFilter
                ? ` · ${session.totalUniqueBeforeFilter - session.uniqueCandidatesFound} filtered as off-target`
                : ''}
              {topScore > 0 ? ` · top match ${topScore}` : ''}
              {session.tokensUsed ? ` · ${session.tokensUsed.toLocaleString()} AI tokens` : ''}
            </p>
          </div>

          <div className="shrink-0">
            <ExportButton
              candidates={selectedCandidatesList}
              roleName={session.searchBrief?.primaryTitle || 'Candidates'}
              removed={session.removedCandidates ?? []}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-white/10 bg-white/10 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.key} className="bg-alphanom-navy/95 px-5 py-4">
              <p className="font-jakarta text-2xl font-bold tabular-nums text-white">{stat.value}</p>
              <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-white/55">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Whether the requirement was actually met, before the list itself.
          Scores alone could not show this: a brief could name Django and the
          shortlist could evidence it for almost nobody, and the screen would
          look identical either way. */}
      <RequirementCoverage candidates={sortedCandidates} brief={session.searchBrief} />

      <div className="card p-5 sm:p-6">
        <CandidateFilters
          filters={filters}
          onFiltersChange={setFilters}
          sortBy={sortBy}
          onSortChange={setSortBy}
          excellentCount={excellentMatches}
          strongCount={strongMatches}
          potentialCount={potentialMatches}
          lowCount={lowMatches}
        />
      </div>

      <div className="card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-alphanom-line pb-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={
                selectedCandidatesList.length === sortedCandidates.length &&
                sortedCandidates.length > 0
              }
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-alphanom-line accent-alphanom-teal"
            />
            <span className="text-sm font-medium text-alphanom-navy">Select all</span>
          </label>

          {(['excellent', 'strong', 'potential'] as const).map((tier) =>
            countOf(tier) > 0 && filters.includes(tier) ? (
              <button
                key={tier}
                type="button"
                onClick={() => toggleSelectByStrength(tier)}
                className="rounded-pill border border-alphanom-line px-3 py-1 text-xs font-medium text-alphanom-muted transition-colors hover:border-alphanom-navy/30 hover:text-alphanom-navy"
              >
                Toggle {tier}
              </button>
            ) : null
          )}

          <span className="ml-auto text-sm text-alphanom-muted">
            <strong className="font-jakarta text-alphanom-navy">
              {selectedCandidatesList.length}
            </strong>{' '}
            of {sortedCandidates.length} selected
          </span>
        </div>

        <CandidateTable
          candidates={sortedCandidates}
          selectedIds={selectedCandidates}
          onToggleCandidate={toggleCandidate}
          onToggleByStrength={toggleSelectByStrength}
        />
      </div>
    </div>
  );
}
