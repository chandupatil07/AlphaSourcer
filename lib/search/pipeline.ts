import { SearchSession, Candidate, SearchBrief } from '@/types/index';
import { parseRequirement } from '@/lib/groq/parseRequirement';
import { buildQueries } from '@/lib/search/buildQueries';
import { serperSearchPaged, isLinkedInProfileUrl } from '@/lib/serper/search';
import { geoFromBrief } from '@/lib/serper/geo';
import { parseSearchResult } from '@/lib/candidates/parseSearchResult';
import { evaluateCandidatesBatch, EvaluationInput } from '@/lib/groq/evaluateCandidate';
import { calculateDeterministicScore } from '@/lib/scoring/deterministic';
import { deduplicateCandidates } from '@/lib/candidates/deduplicate';
import { assessRelevance } from '@/lib/candidates/relevance';
import { verifyCandidateSkills } from '@/lib/search/verifySkills';
import { LIMITS } from '@/config/limits';
import { MATCH_STRENGTH_RANGES, FINAL_SCORE_WEIGHTS } from '@/config/scoring';
import { nanoid } from '@/lib/utils';
import type { SessionStore } from '@/lib/session-store';
import { tokenLedger } from '@/lib/groq/client';

export async function processSearchPipeline(
  sessionId: string,
  requirement: string,
  advancedFilters: any,
  sessionStore: SessionStore
) {
  let session = await sessionStore.get(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  // Single-user local tool: one search at a time, so a module-level ledger is fine.
  tokenLedger.reset();

  // Serverless kills the function at maxDuration. Leave headroom so results are
  // always written, rather than the run dying mid-scoring and stranding the
  // session in a non-terminal state.
  const startedAt = Date.now();
  const AI_REVIEW_DEADLINE_MS = 40000;
  const elapsed = () => Date.now() - startedAt;

  try {
    // Stage 1: Parse Requirement
    session.status = 'analyzing';
    await sessionStore.set(sessionId, session);

    const searchBrief = await parseRequirement(requirement);
    session.searchBrief = searchBrief;
    session.status = 'generating_queries';
    await sessionStore.set(sessionId, session);

    // Stage 2: Generate Queries — deterministic, so every query provably
    // carries an accepted title and the requested location, and it costs no
    // tokens (which also removes a rate-limit failure point).
    const queries = buildQueries(searchBrief);
    if (queries.length === 0) {
      throw new Error('Could not build any search queries from this requirement');
    }
    session.generatedQueries = queries;
    session.status = 'searching';
    await sessionStore.set(sessionId, session);

    // Roughly 40 credits per search, whatever mix of queries the brief produces.
    const pagesPerQuery =
      queries.length > 12 ? 2 : queries.length > 8 ? 3 : LIMITS.resultPagesPerQuery;
    // Country bias for retrieval. Empty when the brief names no location or
    // spans several countries, which keeps the previous worldwide behaviour.
    const geo = geoFromBrief(searchBrief);
    console.log(
      `[search] ${queries.length} queries x ${pagesPerQuery} pages = ~${queries.length * pagesPerQuery} credits`
    );
    console.log(`[geo] ${geo.gl ? `gl=${geo.gl}` : 'no country bias (worldwide)'}`);

    // Stage 3: Search with Serper
    // Queries run concurrently — 8 sequential paged fetches dominated total
    // runtime and would blow past a serverless function's duration limit.
    const searches = await Promise.allSettled(
      queries.map(async (query) => ({
        query,
        // Each page is a Serper credit, so depth is traded against breadth:
        // a few broad queries earn deep paging, many narrow ones do not.
        results: await serperSearchPaged(query.query, pagesPerQuery, geo),
      }))
    );

    const allResults = [];
    let lastSearchError: unknown = null;
    let successfulQueries = 0;

    for (const outcome of searches) {
      if (outcome.status === 'rejected') {
        lastSearchError = outcome.reason;
        console.error('Query failed:', outcome.reason);
        continue;
      }

      successfulQueries++;
      const { query, results } = outcome.value;
      for (const result of results) {
        if (isLinkedInProfileUrl(result.url)) {
          allResults.push({ ...result, queryId: query.id, queryFamily: query.family });
        }
      }
    }

    if (successfulQueries === 0) {
      const detail = lastSearchError instanceof Error ? lastSearchError.message : '';
      if (/credit/i.test(detail)) {
        throw new Error(
          'Serper search credits are exhausted. Top up at serper.dev to run more searches — ' +
            'no candidates could be fetched.'
        );
      }
      throw new Error(`All ${queries.length} searches failed. ${detail}`);
    }

    session.totalResultsFound = allResults.length;
    session.status = 'deduplicating';
    await sessionStore.set(sessionId, session);

    // Stage 4: Extract Candidate Information
    // Serper returns name/title/company structurally, so this needs no LLM call
    // and therefore cannot be throttled away by the token budget.
    const rawCandidates: Partial<Candidate>[] = [];

    for (const result of allResults) {
      const parsed = parseSearchResult(result);

      rawCandidates.push({
        id: nanoid(),
        name: parsed.name,
        currentDesignation: parsed.currentDesignation,
        currentOrganization: parsed.currentOrganization,
        location: parsed.location,
        yearsExperience: parsed.yearsExperience,
        linkedinUrl: result.url,
        searchSnippet: result.snippet,
        sourceQueries: [result.queryId],
        queryFamilies: [result.queryFamily],
        extractionConfidence: parsed.extractionConfidence,
      });
    }

    // Stage 5: Deduplicate
    const allUnique = deduplicateCandidates(rawCandidates);

    // Stage 5a: Confirm skills from search provenance.
    //
    // Google matches against the whole indexed profile, not the ~160 character
    // snippet it chooses to display. So a profile returned by a query that
    // demanded "Django" provably contains that term, whether or not the snippet
    // shows it. Reading the query that found a candidate therefore recovers the
    // one signal the snippet almost never carries — at no extra cost, from data
    // the pipeline was already storing and discarding.
    //
    // The inverse does NOT hold. A probe returns one page of results, so a
    // candidate missing from it may simply have ranked below the cut. Absence
    // is recorded as untested, never as a missing skill.
    const skillsByQuery = new Map<string, string[]>();
    for (const q of queries) {
      if (q.requiresSkills?.length) skillsByQuery.set(q.id, q.requiresSkills);
    }
    const probedSkills = new Set(
      [...skillsByQuery.values()].flat().map((s) => s.toLowerCase())
    );

    for (const candidate of allUnique) {
      const confirmed = new Set<string>();
      for (const queryId of candidate.sourceQueries) {
        for (const skill of skillsByQuery.get(queryId) ?? []) confirmed.add(skill);
      }
      candidate.confirmedSkills = [...confirmed];
      // A skill nobody probed for cannot be judged either way.
      candidate.untestedSkills = searchBrief.mustHaveSkills.filter(
        (skill) =>
          !probedSkills.has(skill.toLowerCase()) &&
          !confirmed.has(skill)
      );
    }

    const withConfirmedSkill = allUnique.filter((
      c
    ) => (c.confirmedSkills?.length ?? 0) > 0).length;
    console.log(
      `[skills] ${skillsByQuery.size} probe queries; ` +
        `${withConfirmedSkill}/${allUnique.length} candidates have at least one skill confirmed`
    );

    // Stage 5b: Relevance gate. Deterministic, so it costs nothing and applies
    // to every candidate rather than only the slice the LLM reviews.
    const relevant: Candidate[] = [];
    const removed: Candidate[] = [];

    for (const candidate of allUnique) {
      const verdict = assessRelevance(candidate, searchBrief);
      const tagged: Candidate = {
        ...candidate,
        relevanceTier: verdict.tier,
        relevanceLabel: verdict.tierLabel,
        relevanceReason: verdict.reason,
        relevanceScore: verdict.score,
      };
      (verdict.keep ? relevant : removed).push(tagged);
    }

    // No safety valve here by design: the gate is intentionally strict, so a
    // high removal rate means the search returned the wrong people, not that
    // the filter is mis-calibrated. Re-admitting them would defeat the point.
    session.removedCandidates = removed;
    const deduplicatedCandidates = relevant;
    session.totalUniqueBeforeFilter = allUnique.length;
    session.uniqueCandidatesFound = relevant.length;

    // Stage 6: Score Candidates
    session.status = 'scoring';
    await sessionStore.set(sessionId, session);

    // Deterministic scoring is free, so every candidate gets one.
    const scoreAll = () =>
      deduplicatedCandidates
        .map((candidate) => ({
          candidate,
          deterministicScore: calculateDeterministicScore(candidate, searchBrief),
        }))
        .sort((a, b) => b.deterministicScore - a.deterministicScore);

    let ranked = scoreAll();

    // Stage 6a: verify skills on the strongest candidates, then score again.
    //
    // Scoring first is what makes this affordable: the probe budget is spent
    // on the people who can still reach a recruiter rather than on all 239.
    // Scoring again afterwards is what makes it matter -- a skill settled here
    // changes the order, and the order is what the recruiter sees.
    const beforeVerification = deduplicatedCandidates.filter(
      (c) => (c.confirmedSkills?.length ?? 0) > 0
    ).length;

    const verification = await verifyCandidateSkills(
      ranked.map((r) => r.candidate),
      searchBrief,
      { elapsed }
    );
    if (verification.probes > 0) {
      ranked = scoreAll();
      // Counted over the SAME pool as the line below, on purpose. This first
      // reported against the kept shortlist while stage 5a reported against
      // every unique candidate, so the live run printed "49/194" and then
      // "31/122" -- which reads as verification having LOST confirmations
      // when the two numbers simply count different people.
      const confirmedIn = (list: Candidate[]) =>
        list.filter((c) => (c.confirmedSkills?.length ?? 0) > 0).length;
      console.log(
        `[skills] after verification: ${confirmedIn(deduplicatedCandidates)}/${deduplicatedCandidates.length} ` +
          `of the shortlist have at least one skill confirmed ` +
          `(it was ${beforeVerification}/${deduplicatedCandidates.length} before the probes)`
      );
    }
    session.skillVerification = verification;

    const forReview = ranked.slice(0, LIMITS.maxCandidatesForEvaluation);
    const remainder = ranked.slice(LIMITS.maxCandidatesForEvaluation);

    const scoredCandidates: Candidate[] = [];
    let evaluationFailures = 0;

    // Batches run concurrently: sequential evaluation was the largest remaining
    // block of wall-clock time, and serverless budgets time, not requests.
    const batches: Array<Array<(typeof forReview)[number]>> = [];
    for (let i = 0; i < forReview.length; i += LIMITS.evaluationBatchSize) {
      batches.push(forReview.slice(i, i + LIMITS.evaluationBatchSize));
    }

    const budgetLeft = AI_REVIEW_DEADLINE_MS - elapsed();
    if (budgetLeft < 5000 && batches.length > 0) {
      console.warn(`[pipeline] ${Math.round(elapsed() / 1000)}s elapsed; skipping AI review to finish in time`);
    }

    const batchResults = budgetLeft < 5000
      ? batches.map(() => null)
      : await Promise.all(
      batches.map(async (batch) => {
        const inputs: EvaluationInput[] = batch.map(({ candidate, deterministicScore }) => ({
          name: candidate.name,
          designation: candidate.currentDesignation,
          organization: candidate.currentOrganization,
          location: candidate.location,
          snippet: candidate.searchSnippet,
          deterministicScore,
        }));

        try {
          return await evaluateCandidatesBatch(searchBrief, inputs);
        } catch (error) {
          console.error('Batch evaluation failed:', error);
          return null;
        }
      })
    );

    batches.forEach((batch, batchIndex) => {
      const evaluations = batchResults[batchIndex];
      if (!evaluations) evaluationFailures += batch.length;

      batch.forEach(({ candidate, deterministicScore }, index) => {
        const evaluation = evaluations?.[index];
        const contextualScore = evaluation?.contextualScore ?? deterministicScore;
        const finalScore =
          deterministicScore * FINAL_SCORE_WEIGHTS.deterministic +
          contextualScore * FINAL_SCORE_WEIGHTS.contextual;

        scoredCandidates.push({
          ...candidate,
          deterministicScore,
          contextualScore,
          finalScore,
          matchStrength: getMatchStrengthFromScore(finalScore),
          confirmedMatches: evaluation?.confirmedMatches ?? [],
          uncertainRequirements: evaluation?.uncertainRequirements ?? [],
          mismatchFlags: evaluation?.mismatchFlags ?? [],
          reasoningSummary:
            evaluation?.reasoningSummary ||
            'Scored on profile signals only; AI review unavailable.',
          selected: false,
        });
      });
    });

    session.candidates = [...scoredCandidates].sort((a, b) => b.finalScore - a.finalScore);
    await sessionStore.set(sessionId, session);

    // Anyone past the review cut still ships, ranked on deterministic signals.
    for (const { candidate, deterministicScore } of remainder) {
      scoredCandidates.push({
        ...candidate,
        deterministicScore,
        contextualScore: deterministicScore,
        finalScore: deterministicScore,
        matchStrength: getMatchStrengthFromScore(deterministicScore),
        confirmedMatches: [],
        uncertainRequirements: [],
        mismatchFlags: [],
        reasoningSummary: 'Ranked on profile signals; not AI-reviewed.',
        selected: false,
      });
    }

    if (evaluationFailures > 0) {
      session.warning =
        `${evaluationFailures} candidate(s) were ranked on profile signals only — ` +
        `the AI review step hit its rate limit. Ranking is still valid, just less nuanced.`;
    }

    // Tier first, then score: a Core title match outranks an Adjacent one even
    // when keyword-based scoring happens to favour the latter.
    // Relevance first — it reflects the stated requirements — then the scoring
    // pipeline's own assessment as a tie-break.
    scoredCandidates.sort((a, b) => {
      const rel = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
      return rel !== 0 ? rel : b.finalScore - a.finalScore;
    });

    session.candidates = scoredCandidates;
    session.tokensUsed = tokenLedger.total;
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    await sessionStore.set(sessionId, session);
  } catch (error) {
    console.error('Pipeline error:', error);
    session.status = 'failed';
    session.error = error instanceof Error ? error.message : 'Unknown error';
    await sessionStore.set(sessionId, session);
  }
}

/**
 * Reads the bands from config/scoring rather than repeating the numbers.
 * MATCH_STRENGTH_RANGES was already imported here and never used while this
 * function hard-coded 90/75/60, so the config could be edited with no effect
 * on behaviour -- and the export sheet, which labels the same bands, would
 * then disagree with both.
 */
function getMatchStrengthFromScore(score: number): 'excellent' | 'strong' | 'potential' | 'low' {
  if (score >= MATCH_STRENGTH_RANGES.excellent.min) return 'excellent';
  if (score >= MATCH_STRENGTH_RANGES.strong.min) return 'strong';
  if (score >= MATCH_STRENGTH_RANGES.potential.min) return 'potential';
  return 'low';
}
