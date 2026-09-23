/**
 * Produces a CSV of candidates to label by hand.
 *
 *   npx tsx eval/label.ts <session.json> [howMany]
 *
 * Everything measured so far is recall and location precision: more
 * candidates, cleaner candidates, the right city. Whether the RIGHT people
 * rank at the top has never been measured, because nothing has ever told the
 * system what "right" means. This is how that starts.
 *
 * Two deliberate choices, both to keep the resulting numbers honest:
 *
 * 1. The rows are the UNION of the top N under the baseline scoring
 *    (eval/_baseline, the owner's master) and the top N under the current
 *    code. Labelling only the current code's top N would mean the baseline
 *    gets judged on candidates nobody looked at, and it would score worse for
 *    that reason alone rather than on merit.
 *
 * 2. The rows are SHUFFLED, and carry no score and no rank. A human labelling
 *    a ranked list agrees with the ranking -- the position anchors the
 *    judgement, and the measurement then confirms whatever it was given.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import { calculateDeterministicScore as scoreNew } from '@/lib/scoring/deterministic';
import { calculateDeterministicScore as scoreOld } from '@/eval/_baseline/deterministic';
import { parseSearchResult } from '@/lib/candidates/parseSearchResult';

const [sessionPath, howManyRaw] = process.argv.slice(2);
if (!sessionPath) {
  console.error('usage: npx tsx eval/label.ts <session.json> [howMany]');
  process.exit(1);
}

const TOP_N = Number(howManyRaw) || 25;

const session = JSON.parse(readFileSync(resolve(process.cwd(), sessionPath), 'utf8'));
const brief = session.searchBrief;
const pool: any[] = [...(session.candidates ?? []), ...(session.removedCandidates ?? [])];

// Re-parse so each candidate carries the fields today's parser reads, rather
// than whatever the code at record time managed to extract.
const rows = pool.map((c) => {
  const parsed = parseSearchResult({
    title: `${c.name} - ${c.currentDesignation ?? ''}`.trim(),
    url: c.linkedinUrl ?? '',
    snippet: c.searchSnippet ?? '',
    position: 0,
  } as any);
  return {
    ...c,
    location: parsed.location,
    currentOrganization: c.currentOrganization ?? parsed.currentOrganization,
    yearsExperience: parsed.yearsExperience,
    confirmedSkills: c.confirmedSkills ?? [],
  };
});

const rank = (fn: (c: any, b: any) => number) =>
  rows
    .map((c) => ({ c, s: fn(c as any, brief) }))
    .sort((a, b) => b.s - a.s)
    .map((r) => r.c);

const topOld = rank(scoreOld as any).slice(0, TOP_N);
const topNew = rank(scoreNew as any).slice(0, TOP_N);

const byUrl = new Map<string, any>();
for (const c of [...topNew, ...topOld]) {
  const url = (c.linkedinUrl ?? '').toLowerCase();
  if (url && !byUrl.has(url)) byUrl.set(url, c);
}

// Fisher-Yates. Seeded from nothing: a different order each time is fine,
// the labels are keyed by URL, not by row position.
const shuffled = [...byUrl.values()];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}

const csvCell = (value: unknown): string => {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const header = ['label', 'name', 'title', 'company', 'location', 'url'];
const lines = [header.join(',')];
for (const c of shuffled) {
  lines.push(
    [
      '', // label — to be filled in: g / b / ?
      csvCell(c.name),
      csvCell(c.currentDesignation),
      csvCell(c.currentOrganization),
      csvCell(c.location),
      csvCell(c.linkedinUrl),
    ].join(',')
  );
}

const outDir = resolve(process.cwd(), 'eval/labels');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, basename(sessionPath).replace(/\.json$/, '') + '-labels.csv');
writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

console.log();
console.log(`Brief : ${String(session.rawRequirement).split('\n')[0].slice(0, 70)}`);
console.log(`Pool  : ${pool.length} candidates`);
console.log(`Rows  : ${shuffled.length}  (union of the top ${TOP_N} under each scoring, shuffled)`);
console.log();
console.log(`Written: ${outPath}`);
console.log();
console.log('Open it in Excel and fill the FIRST column only:');
console.log();
console.log('    g   this person is worth contacting for this role');
console.log('    b   they are not');
console.log('    ?   cannot tell from the profile -- leave the judgement out');
console.log();
console.log('Blank rows are treated the same as ? and are excluded, so stopping');
console.log('early is fine. Open the URL when the headline is not enough.');
console.log();
console.log('There is no score and no rank in the file on purpose: seeing the');
console.log('rank while labelling makes a person agree with it, and the result');
console.log('would then just confirm whatever ranking produced it.');
console.log();
console.log('Then:');
console.log(`    npx tsx eval/accuracy.ts ${sessionPath} ${outPath.replace(process.cwd() + '/', '').replace(/\\/g, '/')}`);
console.log();
