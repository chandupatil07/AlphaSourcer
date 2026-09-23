/**
 * Measures whether the RIGHT people rank at the top.
 *
 *   npx tsx eval/accuracy.ts <session.json> <labels.csv>
 *
 * Every other harness here measures recall and coverage -- how many
 * candidates, how many with a city, how many with a confirmed skill. Those are
 * real, and they are not accuracy. This one needs a human to have said which
 * candidates are actually worth contacting, and then reports precision@k for
 * the baseline scoring and the current scoring side by side.
 *
 * Costs nothing to run: no network, no Serper credits, no Groq tokens.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { calculateDeterministicScore as scoreNew } from '@/lib/scoring/deterministic';
import { calculateDeterministicScore as scoreOld } from '@/eval/_baseline/deterministic';
import { parseSearchResult } from '@/lib/candidates/parseSearchResult';

const [sessionPath, labelsPath] = process.argv.slice(2);
if (!sessionPath || !labelsPath) {
  console.error('usage: npx tsx eval/accuracy.ts <session.json> <labels.csv>');
  process.exit(1);
}

/** Minimal CSV reader: enough for the file eval/label.ts writes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const csv = parseCsv(readFileSync(resolve(process.cwd(), labelsPath), 'utf8'));
const header = csv[0].map((h) => h.trim().toLowerCase());
const iLabel = header.indexOf('label');
const iUrl = header.indexOf('url');
if (iLabel === -1 || iUrl === -1) {
  console.error('The labels file needs a "label" column and a "url" column.');
  process.exit(1);
}

const labels = new Map<string, 'good' | 'bad'>();
let unlabelled = 0;
for (const row of csv.slice(1)) {
  const raw = (row[iLabel] ?? '').trim().toLowerCase();
  const url = (row[iUrl] ?? '').trim().toLowerCase();
  if (!url) continue;
  if (raw === 'g' || raw === 'good' || raw === 'y' || raw === '1') labels.set(url, 'good');
  else if (raw === 'b' || raw === 'bad' || raw === 'n' || raw === '0') labels.set(url, 'bad');
  else unlabelled += 1;
}

const goodCount = [...labels.values()].filter((v) => v === 'good').length;
const badCount = labels.size - goodCount;

if (labels.size === 0) {
  console.error('\nNo labels found. Fill the first column with g or b and run again.\n');
  process.exit(1);
}

const session = JSON.parse(readFileSync(resolve(process.cwd(), sessionPath), 'utf8'));
const brief = session.searchBrief;
const pool: any[] = [...(session.candidates ?? []), ...(session.removedCandidates ?? [])];

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
    .sort((a, b) => b.s - a.s);

/**
 * Precision@k over the LABELLED candidates only.
 *
 * Unlabelled and "?" rows leave the denominator rather than counting as bad.
 * Counting an unseen candidate as a failure is the same mistake the skill
 * scoring used to make: unknown is not absent.
 */
function precisionAt(ranked: Array<{ c: any }>, k: number) {
  let seen = 0;
  let good = 0;
  for (const { c } of ranked) {
    const label = labels.get((c.linkedinUrl ?? '').toLowerCase());
    if (!label) continue;
    seen += 1;
    if (label === 'good') good += 1;
    if (seen === k) break;
  }
  return { good, seen, pct: seen ? Math.round((100 * good) / seen) : 0 };
}

const rankedOld = rank(scoreOld as any);
const rankedNew = rank(scoreNew as any);

const line = (ch = '-') => console.log(ch.repeat(64));

console.log();
console.log(`SESSION  ${sessionPath}`);
console.log(`LABELS   ${labelsPath}`);
console.log(`BRIEF    ${String(session.rawRequirement).split('\n')[0].slice(0, 52)}`);
line('=');
console.log(`labelled: ${labels.size}   good: ${goodCount}   bad: ${badCount}   skipped: ${unlabelled}`);
line('=');
console.log();

if (labels.size < 15) {
  console.log('NOTE: fewer than 15 labels. The numbers below will swing a lot on');
  console.log('one row either way -- treat them as a direction, not a result.');
  console.log();
}

console.log('PRECISION @ k  -- of the top k labelled candidates, how many are good');
console.log();
console.log(`${''.padEnd(10)}  ${'BASELINE'.padEnd(18)}  ${'CURRENT'.padEnd(18)}`);
line();
for (const k of [5, 10, 20]) {
  const o = precisionAt(rankedOld, k);
  const n = precisionAt(rankedNew, k);
  if (o.seen === 0 && n.seen === 0) continue;
  const arrow = n.pct > o.pct ? '  better' : n.pct < o.pct ? '  WORSE' : '';
  console.log(
    `top ${String(k).padEnd(6)}  ${`${o.good}/${o.seen} (${o.pct}%)`.padEnd(18)}  ${`${n.good}/${n.seen} (${n.pct}%)`.padEnd(18)}${arrow}`
  );
}
line();

// Where the good ones actually sit. A good candidate ranked 60th is a recall
// problem that precision@10 cannot see.
console.log();
console.log('WHERE THE GOOD CANDIDATES RANK (current scoring)');
const positions: number[] = [];
rankedNew.forEach(({ c }, i) => {
  if (labels.get((c.linkedinUrl ?? '').toLowerCase()) === 'good') positions.push(i + 1);
});
if (positions.length) {
  console.log(`  best ${positions[0]}   median ${positions[Math.floor(positions.length / 2)]}   worst ${positions[positions.length - 1]}`);
  const buried = positions.filter((p) => p > 20).length;
  if (buried) {
    console.log(`  ${buried} good candidate(s) rank below 20 and would never reach AI review.`);
  }
}

console.log();
console.log('GOOD CANDIDATES THE CURRENT SCORING BURIES');
let shown = 0;
rankedNew.forEach(({ c, s }, i) => {
  if (shown >= 5) return;
  if (i < 20) return;
  if (labels.get((c.linkedinUrl ?? '').toLowerCase()) !== 'good') return;
  shown += 1;
  console.log(`  #${String(i + 1).padStart(3)}  score ${String(Math.round(s)).padStart(3)}  ${String(c.name).slice(0, 24).padEnd(26)} ${c.location ?? '(no location)'}`);
});
if (shown === 0) console.log('  none — every labelled good candidate is inside the top 20.');

console.log();
console.log('BAD CANDIDATES THE CURRENT SCORING RANKS HIGH');
shown = 0;
rankedNew.forEach(({ c, s }, i) => {
  if (shown >= 5 || i >= 10) return;
  if (labels.get((c.linkedinUrl ?? '').toLowerCase()) !== 'bad') return;
  shown += 1;
  console.log(`  #${String(i + 1).padStart(3)}  score ${String(Math.round(s)).padStart(3)}  ${String(c.name).slice(0, 24).padEnd(26)} ${String(c.currentDesignation ?? '').slice(0, 30)}`);
});
if (shown === 0) console.log('  none — no labelled bad candidate is inside the top 10.');

console.log();
line('=');
console.log('Read this honestly: with a few dozen labels from one brief, this is a');
console.log('signal, not a verdict. It is still the first number here that is');
console.log('actually about picking the right people rather than finding more of');
console.log('them. Tune against it, then re-label a FRESH search to check the');
console.log('tuning did not just fit these particular rows.');
line('=');
console.log();
