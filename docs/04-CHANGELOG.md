# 04 — Change Log

Every change to the pipeline, in the order it was made, with the measurement
that justified it. If a change has no number next to it, it should not be here.

**Baseline for all comparisons:** commit `7e1dcc3` (owner's `master`).
**Harnesses used** — all free, no Serper credits, no Groq tokens, no network:

```bash
npm run check                                    # tsc --noEmit + next build
npx tsx eval/prove.ts eval/fixtures/run1-before-fixes.json   # owner's code vs this branch, side by side
npx tsx eval/replay.ts b.json                    # re-score a recorded session
npx tsx eval/compare.ts <before.json> <after.json>
```

---

## Session 2 — 22 September 2026

Brief from the owner: candidates from the wrong countries were still
appearing, and the wrong candidates were ranking at the top.

### The diagnosis that changed the plan

The obvious assumption was that location *parsing* was too weak. Measuring it
first showed that was wrong, and it saved a day of work on the wrong file.

```
location extracted, with a 35-city dictionary   : 101 / 235 (43%)
location extracted, with a ~300-city dictionary : 104 / 235 (44%)
```

Three more candidates. Reading the snippets that still failed showed why:

```
"Senior Backend Engineer @ Amazon AWS | ex-Adobe | Cloud Computing ..."
"Backend Engineer with 5 years ... Currently working at Flipkart, ..."
```

**They contain no city at all.** 44% is close to the ceiling for snippet
parsing, so no amount of dictionary work would fix it.

The real cause was upstream, in what was being retrieved:

```
queries generated for a "Bangalore" brief : 18
queries that named the location           :  8
queries with NO location constraint       : 10   <-- the whole problem
```

Ten of the eighteen queries searched for Amazon / Flipkart / Swiggy backend
engineers **anywhere in the world**. Seattle, Dublin, Toronto. Filtering
afterwards cannot recover from that: a foreign profile whose city cannot be
read is kept, because unknown is deliberately not treated as elsewhere.

---

### 1. Retrieval is biased to the country the brief asks for

| | |
|---|---|
| **Files** | `lib/geo/places.ts` (new), `lib/serper/geo.ts` (new), `lib/serper/search.ts`, `lib/search/pipeline.ts` |
| **Commit** | `fad200d` |

The Serper request carried only the query text and `num: 10` — no `gl`, no
`hl`. Every search was a worldwide Google search.

Now the pipeline derives a country from the brief and sends `gl`. Verified
against all three recorded briefs:

```
locations ["India"],    variants ["India","IN"]              -> gl=in
locations ["Bangalore"], variants ["Bengaluru","Bangalore, India"] -> gl=in
```

**No bias is sent** when the brief names no location or spans more than one
country, so those searches behave exactly as before. `geoParams()` validates
the code is two letters before it goes near the request body — a malformed
`gl` would make Serper reject the call and lose the whole page.

`lib/geo/places.ts` also replaces two separate, differing city lists (one in
`relevance.ts`, one in `parseSearchResult.ts`). A city in one but not the
other produced a profile whose location could be read but not matched, or the
reverse.

### 2. Company-led queries now carry the location clause

| | |
|---|---|
| **File** | `lib/search/buildQueries.ts` |
| **Commit** | `3f6ca1c` |

The file's own doc comment states: *"Every query is guaranteed to name an
accepted job title **and the requested location**."* The company-led branch
omitted it.

| | Before | After |
|---|---|---|
| Queries carrying the city | 8 / 18 | **18 / 18** |

`where` is an empty string when the brief names no location, so a
location-free brief is unaffected.

### 3. Location is scored on evidence, not on a word appearing in the text

| | |
|---|---|
| **File** | `lib/scoring/deterministic.ts` |
| **Commit** | `a3b7c4a` |

`calculateLocationScore` concatenated the extracted location with the raw
snippet and substring-matched the result. Three very different candidates all
scored **100**:

- one whose profile states Bengaluru
- one whose snippet mentions a Bangalore *client*
- a recruiter whose post reads *"Hiring Backend Developer — Bangalore (hybrid)"*

The extracted location — the one field the parser takes care to validate —
counted for no more than a stray word.

Now tiered by strength of evidence:

| Score | Meaning |
|---|---|
| 100 | the profile's own location matches the brief |
| 70 | no location on the profile, but the text names the place |
| 45 | the profile's location is in the right country, wrong city |
| 35 | no location and no mention — unknown, which is **not** "elsewhere" |
| 10 | the profile's location is somewhere else entirely |

Matching is whole-word and runs through `lib/geo/places`, so `Bangalore` /
`Bengaluru` and `"Bangalore, India"` all resolve.

**Measured, ranking the same 235 recorded candidates:**

| | Owner's code | This branch |
|---|---|---|
| Top 10 with a **confirmed** Bangalore location | 7 / 10 | **10 / 10** |
| Top 20 with a **confirmed** Bangalore location | 15 / 20 | **16 / 20** |

### 4. Job adverts are no longer treated as candidates

| | |
|---|---|
| **Files** | `lib/candidates/jobAdvert.ts` (new), `lib/candidates/relevance.ts` |
| **Commit** | `93e9f52` |

A recruiter who writes their vacancy into their own headline produces a page
that looks, to every downstream stage, like a person whose job title *is* the
role being hired for — so it matches the title requirement perfectly and can
rank near the top. The recruiter finds an advert for their own vacancy in
their shortlist.

Seen live:

```
"Looking for Backend Developer(Java & Python) - Bangalore(hybrid)
 &.Inbox for further details."
```

The opposite error matters more: **a recruiter IS a valid candidate when the
brief hires recruiters.** So this requires either one unambiguous advert
phrase (`we are hiring`, `walk-in`, `interested candidates`) or two weaker
ones together (`looking for` + `inbox`), and excludes with the phrase that
fired rather than dropping anything silently.

| Recorded session | Flagged | False positives |
|---|---|---|
| `02nonofr5.json` (235) | 1 | 0 |
| `xq6l4uyy3.json` (306) | 1 | 0 |
| `b.json` (103, a BGV brief full of genuine recruiters) | 0 | 0 |

### 5. Employer extraction — 12% → 47%

| | |
|---|---|
| **File** | `lib/candidates/parseSearchResult.ts` |
| **Commit** | `c4f89b4` |

Employer carries **30% of the relevance weight**, and only 12% of candidates
had one — so most of that weight was being decided by an absence rather than
by evidence. LinkedIn headlines nearly always name the employer; the parser
knew only one of the shapes they use.

Added `@ Company` / `@Company` and `<role> at Company`, and stripped Google's
own section labels (`"Experience InMobi 5 years"` was yielding the employer
*"Experience InMobi"*).

Two mistakes are specifically avoided, and both were verified on live data:

| Snippet | Extracted | Not |
|---|---|---|
| `Senior Backend Developer at LiveRamp \| Ex-Freshworks \| Ex-TCS` | LiveRamp | Freshworks |
| `Staff Backend Engineer at Coupang \| Ex Microsoft Flipkart` | Coupang | Microsoft |
| `Backend Engineer @Uber \| ex-PhonePe` | Uber | PhonePe |

`"based at Bangalore"` is a place, not a company — anything resolving to a
known city or country through `lib/geo/places` is rejected.

| | Before | After |
|---|---|---|
| Employer extracted | 29 / 235 (12%) | **111 / 235 (47%)** |
| Past employers wrongly read as current | — | **0** |
| Place names read as employers | — | **0** |

### 6. Location parsing: shared dataset, two false positives closed

| | |
|---|---|
| **File** | `lib/candidates/parseSearchResult.ts` |
| **Commit** | `c72bc2c` |

- An `Education: ... , Roorkee` run names the **institution's** city, not the
  candidate's. It was being read as their location. Education runs are now
  removed before any place is looked for.
- The bare mid-sentence city scan now skips names that are also ordinary
  words or famous universities — *Reading, Cambridge, Oxford, Phoenix*. They
  stay usable inside a comma run, where the context disambiguates them.
- The bare scan compiles **one** alternation at module load instead of a
  `RegExp` per city per snippet — several hundred constructions per candidate
  across hundreds of candidates.

Coverage 101 → 104 of 235. Small, as the diagnosis above predicted.

### 7. CI — every push and pull request is now checked

| | |
|---|---|
| **Files** | `.github/workflows/ci.yml` (new), `package.json` |
| **Commit** | `3832706` |

The repository had **no automated checks**, which is why a commit that did
not compile could sit on a branch unnoticed and fail only at deploy time.
`next dev` type-checks loosely; `next build` is strict.

CI runs `tsc --noEmit`, a production build, and the replay harness on a
session recorded in the repo. `npm run check` does the first two locally.

---

## Verification before this was handed over

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` (production, clean install) | ✅ all routes compiled |
| `npx tsx eval/replay.ts b.json` | ✅ runs |
| `npx tsx eval/prove.ts eval/fixtures/run1-before-fixes.json` | ✅ runs |
| UI files touched | **none** — `components/` and `app/` unchanged |
| Owner's `master` | **untouched** |

The build was run from a clean `git archive` of the committed tree with a
fresh `npm ci`, so it verifies exactly what a deployment would build — not a
local working directory that happens to have stale artifacts in it.

---

## Deliberately NOT done, and why

**Title acronyms (`sde`, `swe`, `mts`).** Real gap — *"Senior Backend
Engineer (SDE II)"* appears in the live data and a candidate whose title is
only *"SDE II"* scores poorly on a 25% weight. Left alone because widening
title matching can only be shown to be safe against candidates a human has
labelled, and there are none yet. Adding it blind trades a measurable problem
for an unmeasurable one.

**Moving `KEEP_THRESHOLD` (55) or the weights in `config/scoring.ts`.** Both
control a large share of the funnel. Neither should move without knowing where
the current numbers came from, and without labelled data to measure the
result.

**Raising `maxCandidatesForEvaluation` (20).** Of 208 kept candidates, 188
are never AI-reviewed. Raising it costs Groq tokens on every search — an
owner's decision, not a bug fix.

**Adding `tsx` to `devDependencies`.** It would mean regenerating
`package-lock.json` on a deploy day. CI uses `npx tsx`, which works. Worth
doing on a calmer day.

**Serper's `location` parameter.** `gl` is a two-letter code and safe. Serper
also accepts a free-text `location`, but it must match Google's own canonical
location names, and an unrecognised value risks failing the request and
losing a whole page of results. Not worth it without testing against the live
API first.

---

## Still open

| | Why it is still open |
|---|---|
| Skill confirmation at 17% | Needs a targeted probe per candidate, ~1 Serper credit each. Owner's call on cost |
| Experience: 32% coverage on a 20% weight | Extract properly, or redistribute the weight and mark it unverified — a product decision |
| Location unknown for ~56% of candidates | They are kept, deliberately. Whether to show, rank down, or hide them is the owner's call |
| Nothing measures whether the **right** people rank at the top | Needs 30–50 candidates from one brief labelled good/bad by a human. Everything proven so far is recall and location precision |
| No SERP caching | Re-scoring a search costs credits, which is what makes accuracy experiments expensive |

---

## Session 2, part 2 — the un-audited files

The first pass covered retrieval, parsing and scoring. These are the files
that had not been read yet: de-duplication, the session store, the exporter
and the model config.

### 8. Duplicate profiles kept the first snippet, not the best one

| | |
|---|---|
| **File** | `lib/candidates/deduplicate.ts` · **Commit** `e234d7a` |

The same person appears once per query that found them — 358 raw results
carried 306 distinct profiles — and Google picks a different preview for each
query, so one appearance may state the city while another states the
employer. The merge kept whichever snippet arrived first and discarded the
rest, although skills, location and experience are all read back out of that
text downstream.

Now keeps the longest snippet and the highest extraction confidence.

**Also deleted a dead `nameOrgMap`** that was built, never read, and
described by a comment as "secondary deduplication by name + organization".
Measuring it showed it should stay deleted: across 644 recorded candidates it
would have merged exactly **one** pair — two different people both named
Abhishek Kumar with no employer extracted. Merging distinct people is worse
than listing one twice.

### 9. An unreadable session returned 500 instead of 404

| | |
|---|---|
| **File** | `lib/session-store.ts` · **Commit** `f70d2c2` |

Both stores called `JSON.parse` on the stored value with no guard. The client
polls that route every couple of seconds and handles a 404 cleanly; a 500
leaves it polling a dead session indefinitely. Unreadable sessions are now
treated as missing, and the cause is logged rather than swallowed.

The file store also wrote non-atomically while the pipeline saves the session
repeatedly during a search, so a poll landing mid-write read a half-written
file. It now writes to a temp file and renames.

**Measured while here:** a 306-candidate session serialises to **293 KB**.
Upstash rejects requests over 1 MB, so there is roughly 3× headroom — worth
knowing before anyone raises the page count.

### 10. The score bands were defined in three places

| | |
|---|---|
| **Files** | `lib/search/pipeline.ts`, `lib/export/excel.ts` · **Commit** `509a4e3` |

90 / 75 / 60 lived in `MATCH_STRENGTH_RANGES`, again as hard-coded numbers in
`getMatchStrengthFromScore`, and again as hard-coded label text in the Excel
summary. `MATCH_STRENGTH_RANGES` was **imported into `pipeline.ts` and never
used** — so editing the config changed nothing, and the export sheet would
have gone on stating a range the product no longer used.

Behaviour is unchanged today. The point is that it stays unchanged tomorrow.

**Verified** by generating the workbook from a recorded session: 208
shortlisted and 98 removed rows across three sheets, summary reading
"Excellent (90-100)", "Potential (60-74)", "Low (0-59)".

### 11. The evidence was on one laptop and nowhere else

| | |
|---|---|
| **Files** | `eval/fixtures/` · **Commits** `f8ab119`, `847ec2f` |

Every before/after number in these documents came from two live sessions in
`.sessions/` — which is **git-ignored**, correctly, because it is the local
development session store.

So the "run it yourself and check" instructions in the reports **could not
actually be followed by anyone else**. The two sessions are now tracked as
fixtures with a README covering provenance, and CI runs the baseline
comparison against them on every push.

### 12. Model chain tidied

| | |
|---|---|
| **File** | `config/models.ts` · **Commit** `cd86558` |

Replaced a commented-out model and a "changed for testing" note with the
actual finding, and recorded that an account *with* access to `qwen3.6-27b`
should set `GROQ_MODEL_CHAIN` rather than edit the list — the chain is
already configurable per deployment.

---

---

## Session 2, part 3 — the last un-audited files

`clarify.ts`, the three Groq modules, `utils.ts`, the analyze route and the
client polling. Every file in `lib/` and `app/api/` has now been read.

### 13. Session ids could come out one character long

| | |
|---|---|
| **File** | `lib/utils.ts` · **Commit** `9330c82` |

```js
Math.random().toString(36).substr(2, 9)
```

`toString(36)` drops trailing zeros, so the tail is not always nine
characters long. Measured over 200,000 draws: **42 came back with seven or
eight characters**, and the worked case `(0.5).toString(36)` is `"0.i"` — a
**one-character id**.

This generates **session ids** (`app/api/search/route.ts`). Two searches
colliding on an id means one person's results are served to another. It also
seeded candidate and query ids, where a collision silently merges two records.

Now a fixed 12 characters from the platform CSPRNG, with a 32-character
alphabet so the byte-to-character mapping is a mask rather than a modulo and
carries no bias. 60 bits. **Verified: 200,000 draws, all length 12, zero
duplicates.**

Also removed `getMatchStrengthLabel` — unused, and a *fourth* copy of the
90/75/60 boundaries.

### 14. Text interpolated into a prompt could rewrite the prompt

| | |
|---|---|
| **Files** | `lib/groq/parseRequirement.ts`, `lib/groq/evaluateCandidate.ts` · **Commit** `850ba66` |

`String.replace` treats `$&`, `` $` `` and `$'` in the **replacement** as
substitution patterns even when the search pattern is a plain string:

```
"Requirement: {requirement}\nRULES: ..."   with   "Salary $' negotiable"
-> "Requirement: Salary  | RULES: ... negotiable | RULES: ..."
```

The rules are duplicated and the inserted text is mangled. With `$&` the
placeholder itself is re-inserted.

It matters most in `evaluateCandidate`, where the interpolated block is built
from names, headlines and Google snippets — **text this code does not
control**. One profile containing `$'` would truncate the instructions for
the whole batch and silently degrade ten evaluations at once, with no error.

Both now use replacer functions, which disable the substitution.

**Stated honestly:** across 644 recorded candidates, **zero** contain any of
these sequences. This is latent, not a bug anyone has hit — but the input is
untrusted and the fix costs nothing.

### 15. Deleted the unused LLM query generator

| | |
|---|---|
| **File** | `lib/groq/generateQueries.ts` · **Commit** `e52312e` |

No callers. Queries are built deterministically by `buildQueries`, which is
what makes every query provably carry an accepted title and the requested
location. Keeping the module was actively misleading, because the README
still describes the LLM path — so anyone onboarding reads it and builds the
wrong mental model.

### Read and found clean

`clarify.ts`, `normalizeBrief.ts`, `groq/client.ts`, the analyze route, and
the client polling loop in `app/search/[id]/page.tsx`. The Groq client in
particular is well built: model chain, per-request time budget, and
memoisation of models proven unusable.

---

## One recommendation, not done

A session id that does not exist now returns 404 (correct). The client
counts it as a connection failure and, after five polls, shows *"Lost
connection to the search. It may still be running — refresh to check."* For
a genuinely missing session that message is misleading — it should say so
immediately.

Not changed, because it lives in `app/` and this work carries a guarantee
that **no UI file was touched**. Worth doing as a separate, visible change.

---

## Final verification

Run from a clean `git archive` of the committed tree with a fresh `npm ci`,
so it verifies exactly what a deployment builds — not a working directory
with stale artifacts in it.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ all routes compiled |
| `npx tsx eval/replay.ts b.json` | ✅ CI step 1 |
| `npx tsx eval/prove.ts eval/fixtures/run1-before-fixes.json` | ✅ CI step 2 |
| Excel export generated from a real session | ✅ 3 sheets, 306 rows |
| `nanoid` — 200,000 draws | ✅ all length 12, 0 duplicates |
| UI files touched | **none** |
| Owner's `master` | **untouched** |
