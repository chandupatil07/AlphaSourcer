export const LIMITS = {
  maxSearchesPerDay: parseInt(process.env.MAX_SEARCHES_PER_DAY || '50', 10),
  maxQueriesPerSearch: 10,
  // Free Serper caps a response at 10 results, so depth comes from paging.
  resultPagesPerQuery: 6,
  maxResultsPerQuery: 60,
  // Every candidate is scored deterministically; only the strongest go to the
  // LLM, which is what keeps a search inside the free tokens-per-minute budget.
  maxCandidatesForEvaluation: 20,
  evaluationBatchSize: 10,
  requestTimeout: 30000,
  maxRequirementLength: 5000,
};

export const QUERY_LIMITS = {
  minQueriesPerSearch: 6,
  maxQueriesPerSearch: 10,
};

export const SEARCH_LIMITS = {
  minCandidatesPerSearch: 20,
  targetCandidatesPerSearch: 50,
  maxCandidatesPerSearch: 150,
};

/**
 * Per-candidate skill verification.
 *
 * A search snippet is ~160 characters and rarely names a skill, so on a
 * recorded 239-candidate run only 44 had any skill confirmed and the shortlist
 * evidenced Django for 6 of 137. That is a shortage of evidence, not of
 * scoring. Asking Google directly -- `site:linkedin.com/in/<slug> "Django"` --
 * settles one skill for one profile for one credit.
 *
 * It is bounded three ways because it is the only part of the pipeline whose
 * cost scales with the number of candidates: a cap on how many candidates are
 * probed, a hard cap on total probes, and a wall-clock deadline, since the
 * whole request must finish inside Vercel's 60s.
 */
export const SKILL_VERIFICATION = {
  enabled: (process.env.SKILL_VERIFICATION ?? 'on') !== 'off',
  /** Only the strongest candidates; the rest never reach a recruiter anyway. */
  maxCandidates: parseInt(process.env.SKILL_VERIFY_CANDIDATES || '25', 10),
  /** Hard ceiling on credits spent here, whatever the brief asks for. */
  maxProbes: parseInt(process.env.SKILL_VERIFY_PROBES || '60', 10),
  /** Stop starting probes once the run has been going this long. */
  deadlineMs: parseInt(process.env.SKILL_VERIFY_DEADLINE_MS || '30000', 10),
};
