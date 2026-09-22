# eval/fixtures

Two complete search sessions the app recorded itself, kept so every
before/after number in `docs/03-EXPERIMENTS.md` and `docs/04-CHANGELOG.md`
can be re-derived by anyone, at zero cost.

| File | What it is |
|---|---|
| `run1-before-fixes.json` | 15 Sep 2026 · 250 raw results, 235 unique · run against the code at `7e1dcc3` |
| `run2-after-fixes.json` | 15 Sep 2026 · 358 raw results, 306 unique · same brief, same machine, same settings, after the rate-limit and location fixes |

Both used the brief:

> Senior Backend Engineer with 4-7 years of experience in Python, Django and
> AWS. Location: Bangalore.

## Why they live here and not in `.sessions/`

`.sessions/` is the local development session store and is correctly
git-ignored — it fills up with throwaway runtime state. But that meant the
evidence behind every claim was on one laptop and nowhere else, so
"verify it yourself" was not actually possible. These two are copies kept
deliberately as fixtures.

## Using them

```bash
# Run the owner's code and this branch side by side on the same candidates
npx tsx eval/prove.ts eval/fixtures/run1-before-fixes.json

# Re-score a recorded session through today's code
npx tsx eval/replay.ts eval/fixtures/run2-after-fixes.json

# Compare the two runs
npx tsx eval/compare.ts eval/fixtures/run1-before-fixes.json eval/fixtures/run2-after-fixes.json
```

None of these touch the network. No Serper credits, no Groq tokens.

## What is in them

Exactly what the app stores for a search: the raw requirement, the parsed
brief, the generated queries, and every candidate it found — both the ones
kept and the ones removed, each with the reason it was removed.

The candidate data is what Google returns publicly for a `site:linkedin.com/in/`
search: a name, a headline, a snippet and the public profile URL. Nothing was
fetched from LinkedIn itself, and no credentials or personal contact details
are present.
