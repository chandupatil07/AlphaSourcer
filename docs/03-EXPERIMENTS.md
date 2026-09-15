# 03 — Experiment Log

One entry per change intended to affect accuracy. No entry, no merge.

**Harnesses**
- `npx tsx eval/replay.ts <session.json>` — replays a recorded session's real candidates through the current code. Free: no Serper credits, no Groq tokens.
- A live run against `localhost:3000`. Costs ~36 Serper credits. The only way to measure retrieval and skill confirmation, since those depend on what the searches actually return.

---

## EXP-001 — Whole-word matching in the location gate

| | |
|---|---|
| **Date** | 2026-09-15 |
| **Hypothesis** | Accepted location terms are matched as substrings, so a short term admits unrelated places |
| **Change** | Added `matchesTerm()`; `locationMismatch` requires a whole-word match |
| **File** | `lib/candidates/relevance.ts` |
| **Measured on** | `b.json`, 103 candidates |

The brief carried `locationVariants: ["India", "IN"]`. After `normalize()`, `"in"` is an accepted
term, and it occurs inside `united kINgdom`, `virgINia`, `illINois`, `huntINgton`, `argentINa`.

| Metric | Before | After |
|---|---|---|
| Non-India profiles rejected | 10 / 18 | **18 / 18** |
| Kept overall | 29 | 29 |
| Lost | — | 0 |

**Verdict:** ✅ Keep.

**Learned.** A fix can be provably correct and move the headline number by zero — those 8 were
failing other gates anyway. Reporting "no change" honestly is worth more than folding it into the
next experiment to borrow its numbers. It is also the precondition that makes EXP-002 safe.

---

## EXP-002 — A preferred employer should lift a score, not gate it

| | |
|---|---|
| **Date** | 2026-09-15 |
| **Hypothesis** | `scoreEmployer` returns 10 on weight 30 for any employer not named in the brief, turning a preference into a filter |
| **Change** | Non-matching known employer 10 → 50, the neutral already used for an unlisted employer. Matching still scores 100 / 80 / 70 |
| **File** | `lib/candidates/relevance.ts` |
| **Applied on** | EXP-001 |

Sixteen candidates scored exactly 51 against a threshold of 55:

```
title 75 · employer 10 · experience 60 · domain 60
(75×40 + 10×30 + 60×20 + 60×10) / 100 = 51
```

Their titles appear verbatim in `brief.alternativeTitles` — title matching was working. Re-scoring
with the company preference neutralised recovered 13 and lost 0, including a *Verification
Executive* at **Real Check Verification Services Pvt. Ltd.**, a background-verification company
rejected for not being one of the four the brief happened to name.

| Metric | Before | After |
|---|---|---|
| Kept | 29 / 103 | **37 / 103** |
| ...stated location in India | 6 | **13** |
| ...stated location NOT India | 0 | **0** |
| Lost | — | **0** |

**Verdict:** ✅ Keep.

**Learned.** My first diagnosis was wrong. Seeing "Background Check Associate rejected" I concluded
title matching was too strict. The arithmetic showed title scoring 75 and the employer term as the
culprit. Fixing the title matcher would have loosened a working component while the real bug
survived — and widened the funnel for the wrong reason.

**Caveat.** Employer now contributes 30% weight with only three outcomes (100/80/70 on a match, 50
otherwise), so it discriminates less than its weight implies. If a labelled set later shows too
many off-target employers surviving, the answer is a sector-similarity signal — not restoring a
penalty that was deleting good people.

---

## EXP-003 — Confirm skills from search provenance

| | |
|---|---|
| **Date** | 2026-09-15 |
| **Hypothesis** | Skills are scored against a ~160-character snippet that practically never lists them, so the heaviest-weighted dimension is near-zero for nearly everyone |
| **Change** | Queries declare `requiresSkills`; the pipeline reads which query returned each candidate and marks those skills confirmed. Every must-have skill gets its own **quoted** probe query (was: first two only, unquoted). Skills neither confirmed nor visible leave the denominator instead of counting as failures |
| **Files** | `types/index.ts`, `lib/search/buildQueries.ts`, `lib/search/pipeline.ts`, `lib/candidates/relevance.ts`, `lib/scoring/deterministic.ts` |

**The idea.** Google matches against the whole indexed profile, not the snippet it displays. A
profile returned by a query demanding `"Django"` provably contains that term. The pipeline already
recorded `sourceQueries` on every candidate and never read them.

The inverse does not hold: a probe returns one page, so a candidate missing from it may simply have
ranked below the cut. Absence is recorded as **untested**, never as a missing skill.

**Isolated check** (same candidate, brief requiring Python/Django/AWS):

| | Deterministic score |
|---|---|
| No skill evidence | 69.5 |
| 2 of 3 confirmed | **82.6** |

The old code returned 69.5 for both — it could only read the snippet.

**Live run** (see EXP-004 for why the first run undercounted):

| | Run 1 | Run 2 |
|---|---|---|
| Probe queries | 3 | 3 |
| Candidates with ≥1 skill confirmed | 27 / 235 (11%) | **53 / 306 (17%)** |
| Python | 17 | 20 |
| AWS | 10 | 18 |
| **Django** | **0** | **20** |

**Verdict:** ✅ Keep.

**Learned.** Django reading zero was not a flaw in the idea — its probe query was one of the
requests dying in the rate limit (EXP-004). Two bugs were interacting, and the cheap measurement
is what separated them. Without the per-skill breakdown we would have concluded that provenance
does not work for Django and gone looking for a cause that did not exist.

**New risk.** Coverage is 17%, because only candidates found *by a probe query* get confirmation.
Raising it needs targeted verification — querying `site:linkedin.com/in/<slug> "skill"` for the
shortlist, roughly one credit per candidate. Not built; see the queue.

---

## EXP-004 — Rate-limit the Serper client

| | |
|---|---|
| **Date** | 2026-09-15 |
| **Hypothesis** | The pipeline fans out every query and every page at once, exceeding Serper's 5 requests/second |
| **Change** | Request starts spaced 220ms apart via a reserved-slot scheduler; retry with backoff on 429 |
| **File** | `lib/serper/search.ts` |

Found by reading the first live run's output, not by code review:

```
[search] 18 queries x 2 pages = ~36 credits
Serper API error: Rate limit exceeded. You are allowed to submit up to 5 requests per second.
... 13 failures
```

`pipeline.ts` runs all queries through `Promise.allSettled`, and `serperSearchPaged` does the same
for pages — 18 × 2 = 36 simultaneous requests. The parallelism is deliberate (sequential paging
blew past the serverless time limit), so the fix spaces the starts rather than serialising them.

| Metric | Before | After |
|---|---|---|
| Rate-limit failures | **13** | **0** |
| Raw results | 250 | **358** (+43%) |
| Unique candidates | 235 | **306** (+30%) |
| Added latency | — | ~8s |

**Verdict:** ✅ Keep.

**Learned.** A third of every search was being discarded, and from the outside it looked like
nothing worse than "fewer results". No amount of scoring work would have recovered it. Failures
that are caught and swallowed are the ones worth hunting.

---

## EXP-005 — Recover location from snippet prose

| | |
|---|---|
| **Date** | 2026-09-15 |
| **Hypothesis** | Location is read only from `result.subtitle`, which Serper no longer returns |
| **Change** | `locationFromSnippet()` — a `Location:` label, then comma runs anchored on a known country or city, then a bare city mid-sentence |
| **File** | `lib/candidates/parseSearchResult.ts` |

```
snippets containing "Bengaluru, Karnataka, India" etc : 99 / 235 (42%)
candidates with a location extracted                  :  0 / 235 (0%)
```

`locationMismatch` therefore received `null` for all 235 and returned "no mismatch" every time.
**A "Bangalore only" brief was not being enforced at all** — 4 of 235 were dropped for location.

| Metric | Before | After |
|---|---|---|
| Location extracted | 0 / 235 (0%) | **143 / 306 (47%)** |
| Dropped for location | 4 | **19** |
| Kept list — in Bangalore | unknown | **94** |
| Kept list — **elsewhere** | unknown | **0** |
| Kept list — location unknown | 235 | 114 |

**Verdict:** ✅ Keep.

**Learned.** The most damaging bug in the system was invisible in the code — every function did
exactly what it said. It only appeared once a real run showed a field that was always empty. Code
review finds logic errors; only running the thing finds a field that stopped arriving.

**Note.** 114 candidates still have no location and are kept. That is deliberate: unknown is not
the same as elsewhere, and rejecting people for evidence we could not observe is the original sin
this whole body of work is correcting.

---

## Combined result, both live runs

| | Run 1 | Run 2 |
|---|---|---|
| Raw results | 250 | **358** |
| Unique | 235 | **306** |
| Kept | 134 | 208 |
| Rate-limit failures | 13 | **0** |
| Location extracted | 0% | **47%** |
| Out-of-city candidates in results | unknown, unfiltered | **0** |
| Skills confirmed | 27 (11%) | **53 (17%)** |
| Skills with any confirmation | Python, AWS | **Python, Django, AWS** |

**Read this honestly.** Kept rose 134 → 208, which looks like looser filtering. It is not: the pool
grew 30% because the rate-limit fix stopped discarding results, while location filtering got
strictly tighter — `elsewhere = 0` is the proof. Recall and location precision both improved.
Whether the *right people* rank at the top is still unmeasured, and needs labelled candidates.

---

## Queue

| # | Experiment | Needs |
|---|---|---|
| 006 | Make the displayed score and the sort order agree — 26% of pairs inverted on live data | **Owner's decision:** should `relevanceScore` or `finalScore` rank the list? |
| 007 | Experience: extract properly, or redistribute the weight and mark it unverified (32% coverage, 20% weight) | Decision |
| 008 | Employer extraction is 25% — same `subtitle` root cause as location, on a 30% weight | — |
| 009 | Filter job adverts. Headlines like *"Looking for Backend Developer … Inbox for details"* are recruiters, not candidates. Measured: 2 of 134 (1%) | — |
| 010 | Targeted skill verification — `site:linkedin.com/in/<slug> "skill"` for the shortlist, ~1 credit each. Would lift confirmation well past 17% | — |
| 011 | Widen `SYNONYMS` / `ACRONYM_EXPANSIONS` (`sde`, `swe`, `mts`; verification ≈ check ≈ screening) | Labelled set, to confirm it does not over-admit |
| 012 | Zero candidates reach the "Excellent" band (top match 86). Thresholds may be miscalibrated | Labelled set |
| 013 | Remove dead constants, the always-true condition in `sameStem`, the unused `nameOrgMap` | — |
| 014 | Cache SERP responses so re-scoring costs no credits | — |

Not yet: moving `KEEP_THRESHOLD`, re-tuning `config/scoring.ts`, or adding an enrichment API. All
three need more than two runs of one brief.
