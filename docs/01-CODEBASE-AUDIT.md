# 01 — Codebase Audit

**Status:** Complete for the scoring/filtering path
**Date:** 2026-09-15
**Author:** Chandrashekhar Patil
**Commit audited:** `7e1dcc3` (tag `baseline-received-2026-09-15`)
**Method:** read-only source review + `npx tsx eval/replay.ts`, which pushes the 103 real
candidates recorded in `b.json` back through today's code. No API credits were spent.

---

## 0. Headline

The pipeline is in better shape than its README suggests. `relevance.ts` is careful work —
stemming, synonyms, acronym expansion, city aliases, compound-word fixes. Recent commits have
already moved in the right direction: replaying `b.json` through today's code keeps **29 of 103**
candidates where the recorded run kept **19**, a 53% recall gain.

Three problems remain, and they are measured, not guessed:

| # | Problem | Measured | Status |
|---|---------|----------|--------|
| **P1** | The list is ordered by one score and labelled with a different one | **41%** of ranked pairs inverted | open — needs owner's decision |
| **P2** | A *preferred* employer acts as a *filter*, deleting qualified candidates | **13** removed for this reason alone | **fixed**, +8 net |
| **P3** | Experience is 20% of the relevance weight but is never observed | **0 of 103** had experience extracted | open |
| **P4** | The country code `"IN"` substring-matches inside ordinary words, defeating the location gate | **8 of 18** non-India profiles leaked through | **fixed** |

Fixing P2 and P4 together took the funnel from **29 kept to 37** (+28%), admitting 8 candidates,
losing 0, and leaking 0 foreign profiles. See §5.

---

## 1. What the pipeline actually does

Reading `lib/search/pipeline.ts` top to bottom — note this differs from the README:

```
requirement
  → parseRequirement()            Groq → SearchBrief
  → buildQueries()                deterministic, no LLM (README says LLM — outdated)
  → serperSearchPaged()           num=10 forced by free tier; depth via paging
  → isLinkedInProfileUrl()        strict /in/ filter
  → parseSearchResult()           regex, no LLM (README says LLM — outdated)
  → deduplicateCandidates()       keyed on origin + pathname
  → assessRelevance()             HARD GATE — drops candidates entirely
  → calculateDeterministicScore() every survivor
  → evaluateCandidatesBatch()     top 20 only (LIMITS.maxCandidatesForEvaluation)
  → final = det*0.6 + ctx*0.4
  → sort by relevanceScore, then finalScore
```

Two scoring systems coexist:

| | `lib/candidates/relevance.ts` | `lib/scoring/deterministic.ts` |
|---|---|---|
| Weights | title 40 · employer 30 · experience 20 · domain 10 | per role family, `config/scoring.ts` |
| Matching | tokenised, stemmed, synonyms, acronyms, city aliases | raw `String.includes()` |
| Role | **hard gate + primary sort key** | tie-break + selects who gets AI review |
| Surfaced to user | no | **yes** — this is the number on screen |

---

## 2. Confirmed findings

### P1 — The displayed score does not explain the displayed order 🔴

`pipeline.ts:272`
```ts
scoredCandidates.sort((a, b) => {
  const rel = (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
  return rel !== 0 ? rel : b.finalScore - a.finalScore;   // tie-break only
});
```
Order comes from `relevanceScore`. The badge and number come from `finalScore`
(`pipeline.ts:231`, `getMatchStrengthFromScore`). They are computed by different code with
different weights and different matching, so they disagree.

**Measured:** 167 of 406 ranked pairs inverted — **41%**. Visible on the first screen:

```
 #  badge        score   rank-key  name
 3  low             59         82  Shagun Srivastava
 4  low             51         82  Shilpi Harsh
 5  low             40         82  Rahul Matayee
 6  strong          79         73  Anukrati Jain      ← higher score, listed lower
```

A recruiter sees "low 40" ranked above "strong 79". There is nothing in the UI that explains it.
This is the finding most likely to be destroying trust in the tool, and it is not a subtle one.

### P2 — A preferred employer behaves as a hard filter 🔴 *(fixed)*

16 candidates scored exactly 51 against `KEEP_THRESHOLD = 55` — dropped by four points. Their
titles, against a brief for *"Background Verification Specialist"*:

```
51  Background Check Associate
51  Document Verification Executive
51  Verification Executive
51  Compliance Analyst
51  Risk and Compliance Analyst
```

**My first reading was that title matching was too strict. That was wrong.** Those strings appear
*verbatim* in `brief.alternativeTitles`, and `scoreTitle` matches them correctly at 75.

The arithmetic (`WEIGHTS` = title 40, employer 30, experience 20, domain 10):

```
title      75  (matched an alternative title — working correctly)
employer   10  ← relevance.ts:333, "known employer, not one we named"
experience 60  (unknown — see P3)
domain     60  (brief lists no must-have skills)

(75×40 + 10×30 + 60×20 + 60×10) / 100 = 51   → below 55 → removed
```

The brief said *"Target Companies: Springverify, Springworks, AuthBridge, IDFY"* — a
**preference**. `scoreEmployer` scores any other known employer at 10 on a weight of 30, which
converts that preference into a near-hard requirement.

**Controlled experiment** — re-scoring with company preference neutralised: **13 recovered, 0
lost.** Among them a *Verification Executive* at **Real Check Verification Services Pvt. Ltd.** —
a background-verification company, rejected for not being one of the four named.

> Writing a target-company list into a brief — something recruiters do constantly, as a hint —
> silently deletes about a third of the qualified pool. The recruiter never asked for that and
> gets no indication it happened.

**Fix applied:** non-matching employer 10 → 50, the same neutral value already used for an
unlisted employer. Matching still lifts the score (100 / 80 / 70), so the preference now works as
a bonus rather than a filter.

**Still open (not a blocker):** `SYNONYMS` covers only developer/programmer/dev/engineering →
engineer, and `ACRONYM_EXPANSIONS` has 11 entries with no `sde`, `swe` or `mts` — the most common
title stems in Indian tech. Worth widening, but it was not the cause of these 16 drops.

### P4 — A two-letter country code defeats the location gate 🔴 *(fixed)*

`relevance.ts:165`
```ts
for (const term of terms) {
  if (loc.includes(term)) return false;   // substring
}
```

The brief carried `locationVariants: ["India", "IN"]`, so `"in"` became an accepted term — and
`"in"` is a substring of ordinary words:

| Candidate location | contains `in` | result |
|---|---|---|
| London, England, United K**in**gdom | ✓ | accepted |
| Lynchburg, V**i**rg**in**ia, United States | ✓ | accepted |
| Chicago, Ill**in**ois | ✓ | accepted |
| Charleston-Hunt**in**gton Area | ✓ | accepted |
| Buenos Aires, Argent**in**a | ✓ | accepted |

**Measured:** of 18 candidates with a clearly non-India location, only 10 were rejected. **8
leaked through** an India-only brief.

**Fix applied:** whole-word matching via `matchesTerm()`. All 18 are now rejected. A location
written as "Bangalore, IN" still matches, because `IN` stands there as its own word.

On its own this changed the final funnel by zero — those 8 were failing other gates too. It
matters because it is what makes the P2 fix safe: without it, relaxing the employer penalty would
have admitted 5 foreign profiles.

### P3 — Experience is weighted but never observed 🔴

`relevance.ts:260` gives experience a weight of 20. `scoreExperience` returns a neutral 60
whenever `years == null`.

**Measured: `yearsExperience` is null for 103 of 103 candidates — 0% coverage.**

So `scoreExperience` returns the same constant for everyone, always. One fifth of the ranking
weight is inert. Worse, the brief for this session was *"at least 6 months to 1 year of
experience"* — a stated hard requirement the system cannot evaluate at all, for anybody.

`yearsFromSnippet()` in `parseSearchResult.ts` is well written and handles "2 years 2 months",
"1.5 years", "5+ years". It simply never matches, because Google's LinkedIn snippets do not
carry tenure in the form it expects.

There is also a naming problem: even when it does match, the value is *the duration of some role
mentioned in the snippet*, not total career experience. Calling it `yearsExperience` invites the
rest of the code to trust it as something it is not.

---

## 3. Secondary findings

| ID | Finding | Location | Severity |
|----|---------|----------|----------|
| S1 | `locations[0][0]` tests the **first character** of the location string — "Bangalore" becomes a test for the letter "B", which nearly every snippet contains. Non-matching candidates score 50 instead of 20 | `deterministic.ts:212` | Medium — feeds the tie-break and AI-review selection |
| S2 | `yearsExperience` is parsed but never passed to `calculateExperienceScore`, which infers seniority from title words alone. `minExperience` is accepted as a parameter and never used | `deterministic.ts:53,173` | Medium |
| S3 | Skill score is `matched/required × 100`. Snippets rarely name skills, so this is ~0 for most candidates — on the **largest** weight (35 for Technology) | `deterministic.ts:139` | Medium |
| S4 | `calculatePreferenceScore` returns early when `preferredIndustries` is empty, so a brief with only **excluded** industries silently ignores them | `deterministic.ts:246` | Medium |
| S5 | `scoreEmployer` returns 10 (weight 30) for any known-but-unlisted employer. Adding a preferred industry to a brief can push a good candidate from 64 to 49 — under the threshold. Naming an industry *reduces* recall | `relevance.ts:333` | Medium |
| S6 | `STUDENT_MARKERS`, `SENIOR_MARKERS`, `JUNIOR_MARKERS` are declared and never referenced — left behind when the seniority gate was removed | `relevance.ts:202–209` | Low (cleanup) |
| S7 | `sameStem`'s second condition, `shorter.startsWith(shorter.slice(0, MIN_STEM))`, is always true. Only the first condition has any effect | `relevance.ts:84` | Low |
| S8 | `normalizeLinkedInUrl` keeps `origin`, so `in.linkedin.com/in/x` and `www.linkedin.com/in/x` are different people. **0 collisions in this dataset**, but hosts are mixed (in=72, www=22, uk=6) so it is live exposure | `serper/search.ts:105` | Low — real but unrealised |
| S9 | Secondary name+organization dedup builds `nameOrgMap` and never uses it; the function returns `urlMap` only | `deduplicate.ts:69–75` | Low (dead code) |
| S10 | Only the top 20 reach AI review, selected by the deterministic score. In the `pg.json` run 131 survived the gate, so 111 were ranked by the weaker scorer alone | `limits.ts:11`, `pipeline.ts:175` | Medium |
| S11 | `contextualScore` silently falls back to `deterministicScore`, collapsing the 60/40 blend to deterministic-only with only a `session.warning` to show for it | `pipeline.ts:221` | Low |
| S12 | AI review is skipped entirely if 40 s have elapsed (`AI_REVIEW_DEADLINE_MS`). Unmeasured how often this fires in production | `pipeline.ts:34` | Unknown — needs a live run |
| S13 | `b.json` and `pg.json` — real session dumps — are committed at repo root. `pg.json` is a stranded session (`status: "scoring"`, empty candidates) | repo root | Low (hygiene; also our test fixture) |

---

## 4. Hypotheses that were WRONG

Recorded deliberately. Each of these would have cost real time if acted on without reading the code.

| Hypothesis | Verdict | Reality |
|---|---|---|
| Uses decommissioned `mixtral-8x7b-32768` | ❌ Rejected | `openai/gpt-oss-120b` with a fallback chain and token multipliers (`config/models.ts`) |
| Extraction uses an LLM | ❌ Rejected | Deterministic regex parser; comments say the LLM was removed on purpose |
| Queries return `/posts/`, `/jobs/`, `/company/` junk | ❌ Rejected | `isLinkedInProfileUrl` enforces a strict `/in/` pattern |
| Location synonyms are missing | ❌ Rejected in `relevance.ts` | `CITY_ALIASES` and `CITY_COUNTRY` handle Bangalore/Bengaluru. Still literal in `deterministic.ts` (S1) |
| A misparsed tenure hard-rejects good candidates | ❌ Cannot fire | Nothing is parsed at all (P3) — the real problem is absence, not error |
| Subdomain duplicates inflate results | ⚠️ Downgraded | Real in code, **0 occurrences** in 103 records (S8) |
| The skill score being ~0 is the main cause of bad ranking | ⚠️ Downgraded | True, but `deterministic.ts` does not drive order — it drives the tie-break and AI-review selection (S3, S10) |

**The README is stale.** It describes LLM-generated queries and LLM extraction; both are now
deterministic. Anyone onboarding from the README alone will form a wrong model of the system.

---

## 5. Measurement

`eval/replay.ts` replays a recorded session through the current code. Free to run.

```
npx tsx eval/replay.ts b.json
```

**Baseline at `7e1dcc3`, session `b.json` (103 candidates):**

| Metric | Value |
|---|---|
| Kept | 29 / 103 (28%) |
| Dropped — title hard-cut | 48 (65% of drops) |
| Dropped — below threshold 55 | 16 (22%) |
| Dropped — location mismatch | 10 (14%) |
| Near misses (45–54) | 16 |
| Score/order inversions | 167 / 406 (41%) |
| Coverage — designation | 100% |
| Coverage — organization | 52% |
| Coverage — location | 52% |
| Coverage — yearsExperience | **0%** |

**After the P2 + P4 fixes, same session, same harness:**

| Metric | Before | After |
|---|---|---|
| Kept | 29 / 103 | **37 / 103** |
| ...stated location in India | 6 | **13** |
| ...stated location NOT India | 0 | **0** |
| Non-India profiles rejected by the location gate | 10 / 18 | **18 / 18** |
| Candidates newly admitted | — | **8** |
| Candidates lost | — | **0** |

The 8 admitted: *Document Verification Executive*; *Verification Executive* (Chennai);
*Verification Executive* (Delhi); and five compliance analysts in Pune, Thane, Gurgaon and
Bengaluru.

**Honest reading of that result.** Recall rose 28% and the location dimension provably did not
degrade — 18/18 foreign profiles now rejected, versus 10/18 before. But whether all 8 new
candidates are genuinely *good* for a BGV brief is a human judgement: several are compliance
analysts at banks rather than background-verification specialists. Without labelled candidates
this measures **recall and location precision only**. Claiming overall precision improved would
overstate the evidence. That is exactly the gap the golden set in `02-BASELINE-METRICS.md` closes.

**What this does not measure.** A recorded session is a fixed candidate set from one day's
queries, for one brief. It measures scoring and filtering only. It cannot see a strong candidate
the search never retrieved, and one brief is not a trend. Live runs across several briefs, with
hand-labelled results, are still needed before any of these numbers can be called representative.

---

## 6. Recommended order of work

Cheapest and most defensible first. Each is one PR with a before/after from `eval/replay.ts`.

1. **P1 — make order and score agree.** Either sort by the number shown, or show the number that sorts. One decision, one small diff, removes the most visible contradiction in the product.
2. **P3 — stop weighting what we never see.** Either extract experience properly or redistribute the weight and mark it unverified in the UI. Today 20% of the ranking is a constant.
3. **P2 — widen title matching before loosening the threshold.** Add domain synonyms (verification/check/screening/vetting) and the missing acronyms (sde, swe, mts). Re-measure the 16 near misses. Only move `KEEP_THRESHOLD` if evidence still supports it — it is a blunt instrument.
4. **S1, S2, S4 — correctness fixes in `deterministic.ts`.** Small, obviously right, low risk.
5. **S6, S7, S9 — remove dead code.** Zero behaviour change; makes the next reader faster.

Not recommended yet: changing `KEEP_THRESHOLD`, re-tuning `config/scoring.ts` weights, or adding
an enrichment API. All three need more than one session's worth of evidence.

---

## 7. Open questions for the owner

1. Which is intended to rank the list — `relevanceScore` or `finalScore`? The fix for P1 depends entirely on the answer.
2. Can we have 5–8 real client briefs? One session is not enough to tune anything safely.
3. Is `KEEP_THRESHOLD = 55` a considered number or a placeholder?
4. Should `b.json` / `pg.json` stay in the repo? They are useful as test fixtures, but they contain real candidate data — worth a deliberate decision rather than an accident.
5. How often does the 40-second AI-review deadline actually trigger in production?
