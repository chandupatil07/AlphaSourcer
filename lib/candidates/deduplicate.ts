import { Candidate } from '@/types/index';
import { normalizeLinkedInUrl } from '@/lib/serper/search';
import { nanoid } from '@/lib/utils';

/**
 * Collapses the same profile returned by several queries into one candidate.
 *
 * The same person legitimately appears once per query that found them -- on a
 * live run, 358 raw results carried 306 distinct profiles -- and each of those
 * appearances comes with its own Google snippet. Google chooses a different
 * preview depending on the query, so one appearance may state the city while
 * another states the employer.
 *
 * Merging therefore takes the best of each: any field the first appearance
 * lacked is filled from a later one, and the longest snippet is kept, because
 * every later stage -- skills, location, experience -- reads that text.
 *
 * De-duplication is by URL only. A secondary name-plus-employer pass used to
 * be built here and never read, and measuring it showed why it should not be:
 * across 644 recorded candidates it would have merged exactly one pair, two
 * different people both named Abhishek Kumar with no employer extracted.
 * Merging distinct people is far worse than listing one twice.
 */
export function deduplicateCandidates(candidates: Partial<Candidate>[]): Candidate[] {
  const urlMap = new Map<string, Candidate>();

  for (const candidate of candidates) {
    if (!candidate.linkedinUrl) continue;

    const normalizedUrl = normalizeLinkedInUrl(candidate.linkedinUrl);
    const existing = urlMap.get(normalizedUrl);

    if (existing) {
      // Fill anything the first appearance could not extract.
      if (candidate.name && candidate.name !== 'Unknown' && (!existing.name || existing.name === 'Unknown')) {
        existing.name = candidate.name;
      }
      if (candidate.currentDesignation && !existing.currentDesignation) {
        existing.currentDesignation = candidate.currentDesignation;
      }
      if (candidate.currentOrganization && !existing.currentOrganization) {
        existing.currentOrganization = candidate.currentOrganization;
      }
      if (candidate.location && !existing.location) {
        existing.location = candidate.location;
      }
      if (candidate.yearsExperience != null && existing.yearsExperience == null) {
        existing.yearsExperience = candidate.yearsExperience;
      }

      // Keep the richer snippet. Skills, location and experience are all read
      // back out of this text downstream, so discarding the longer preview
      // discards evidence about the same person.
      const incomingSnippet = candidate.searchSnippet ?? '';
      if (incomingSnippet.length > (existing.searchSnippet ?? '').length) {
        existing.searchSnippet = incomingSnippet;
      }

      // Confidence describes how cleanly the profile parsed, so the best
      // parse of the same person is the one worth keeping.
      if ((candidate.extractionConfidence ?? 0) > existing.extractionConfidence) {
        existing.extractionConfidence = candidate.extractionConfidence ?? 0;
      }

      // Provenance is cumulative: which queries found this profile is the
      // evidence that a demanded skill is present, so every query counts.
      if (candidate.sourceQueries?.length) {
        existing.sourceQueries = [...new Set([...existing.sourceQueries, ...candidate.sourceQueries])];
      }
      if (candidate.queryFamilies?.length) {
        existing.queryFamilies = [...new Set([...existing.queryFamilies, ...candidate.queryFamilies])];
      }

      continue;
    }

    urlMap.set(normalizedUrl, {
      id: candidate.id || nanoid(),
      name: candidate.name || 'Unknown',
      currentDesignation: candidate.currentDesignation || null,
      currentOrganization: candidate.currentOrganization || null,
      location: candidate.location || null,
      yearsExperience: candidate.yearsExperience ?? null,
      linkedinUrl: normalizedUrl,
      searchSnippet: candidate.searchSnippet || '',
      sourceQueries: candidate.sourceQueries || [],
      queryFamilies: candidate.queryFamilies || [],
      extractionConfidence: candidate.extractionConfidence || 0,
      deterministicScore: candidate.deterministicScore || 0,
      contextualScore: candidate.contextualScore || 0,
      finalScore: candidate.finalScore || 0,
      matchStrength: candidate.matchStrength || 'low',
      confirmedMatches: candidate.confirmedMatches || [],
      uncertainRequirements: candidate.uncertainRequirements || [],
      mismatchFlags: candidate.mismatchFlags || [],
      reasoningSummary: candidate.reasoningSummary || '',
      selected: false,
    });
  }

  return Array.from(urlMap.values());
}
