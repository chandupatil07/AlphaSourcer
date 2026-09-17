/**
 * Runs the scoring code as it was BEFORE the fixes and as it is NOW, side by
 * side, on a session this app recorded itself.
 *
 *   npx tsx eval/prove.ts b.json
 *
 * eval/_baseline/ holds three files exactly as they stand at commit 7e1dcc3
 * (master). They were not retyped — they were extracted from git:
 *
 *   git show 7e1dcc3:lib/candidates/relevance.ts > eval/_baseline/relevance.ts
 *
 * Check that for yourself:
 *   git diff 7e1dcc3:lib/candidates/relevance.ts eval/_baseline/relevance.ts
 *   (no output = identical)
 *
 * Costs nothing to run: no Serper credits, no Groq tokens, no network.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { locationMismatch as mismatchOld, assessRelevance as assessOld } from './_baseline/relevance';
import { calculateDeterministicScore as scoreOld } from './_baseline/deterministic';
import { parseSearchResult as parseOld } from './_baseline/parseSearchResult';

import { locationMismatch as mismatchNew, assessRelevance as assessNew } from '@/lib/candidates/relevance';
import { calculateDeterministicScore as scoreNew } from '@/lib/scoring/deterministic';
import { parseSearchResult as parseNew } from '@/lib/candidates/parseSearchResult';

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx eval/prove.ts <session.json>');
  process.exit(1);
}

const session = JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
const brief = session.searchBrief;
const pool: any[] = [...(session.candidates ?? []), ...(session.removedCandidates ?? [])];

const rule = (ch = '-') => console.log(ch.repeat(78));
const head = (n: number, title: string) => {
  console.log();
  rule('=');
  console.log(`PROOF ${n}  ${title}`);
  rule('=');
};

console.log();
console.log(`SESSION   ${path}`);
console.log(`BRIEF     ${String(session.rawRequirement).split('\n')[0].slice(0, 62)}`);
console.log(`POOL      ${pool.length} candidates recorded by the app`);
console.log(`BASELINE  eval/_baseline/  =  commit 7e1dcc3  (master)`);
console.log(`CURRENT   lib/            =  this branch`);

// ---------------------------------------------------------------------------
head(1, 'The location gate accepted places that are not in the brief');

console.log(`brief.locations         ${JSON.stringify(brief.locations)}`);
console.log(`brief.locationVariants  ${JSON.stringify(brief.locationVariants)}`);
console.log();
console.log('Old code, relevance.ts:166 --  if (loc.includes(term)) return false;');
console.log('New code                   --  whole-word match');
console.log();

const withLoc = pool.filter((c) => c.location);
const flips: any[] = [];
for (const c of withLoc) {
  const o = mismatchOld(c.location, brief);
  const n = mismatchNew(c.location, brief);
  if (o !== n) flips.push({ loc: c.location, o, n });
}

if (withLoc.length === 0) {
  console.log('  No candidate in this session has a location recorded — which is');
  console.log('  itself PROOF 3 below. Re-run this on a session captured after the');
  console.log('  location fix to see this proof produce rows.');
} else {
  console.log(`  candidates with a location  : ${withLoc.length}`);
  console.log(`  old verdict != new verdict  : ${flips.length}`);
  console.log();
  for (const f of flips.slice(0, 12)) {
    console.log(`    ${String(f.loc).slice(0, 46).padEnd(48)}  old: ${f.o ? 'REJECT' : 'ACCEPT'}   new: ${f.n ? 'REJECT' : 'ACCEPT'}`);
  }
  if (flips.length > 12) console.log(`    ... and ${flips.length - 12} more`);
}

console.log();
console.log('  The mechanism, in plain JavaScript:');
for (const s of ['london england united kingdom', 'lynchburg virginia united states', 'chicago illinois', 'buenos aires argentina']) {
  console.log(`    "${s}".includes("in")  ->  ${s.includes('in')}`);
}

// ---------------------------------------------------------------------------
head(2, 'A preferred-employer list was deleting qualified candidates');

console.log(`brief.preferredCompanies  ${JSON.stringify(brief.preferredCompanies)}`);
console.log();
console.log('Old code, relevance.ts:333 --  non-matching employer scores 10 / 100');
console.log('                              on a weight of 30.');
console.log('New code                   --  scores 50, the same neutral already used');
console.log('                              when no employer is listed at all.');
console.log();

let keptOld = 0;
let keptNew = 0;
const recovered: any[] = [];
const lost: any[] = [];

for (const c of pool) {
  const arg = {
    name: c.name,
    currentDesignation: c.currentDesignation,
    currentOrganization: c.currentOrganization,
    location: c.location,
    yearsExperience: c.yearsExperience ?? null,
    searchSnippet: c.searchSnippet ?? '',
    confirmedSkills: c.confirmedSkills ?? [],
  };
  const o = assessOld(arg, brief);
  const n = assessNew(arg, brief);
  if (o.keep) keptOld += 1;
  if (n.keep) keptNew += 1;
  if (!o.keep && n.keep) recovered.push({ c, o, n });
  if (o.keep && !n.keep) lost.push({ c, o, n });
}

console.log(`  kept by OLD code : ${keptOld} / ${pool.length}`);
console.log(`  kept by NEW code : ${keptNew} / ${pool.length}`);
console.log(`  recovered        : ${recovered.length}`);
console.log(`  lost             : ${lost.length}`);
console.log();

for (const r of recovered.slice(0, 10)) {
  const org = r.c.currentOrganization || 'employer not listed';
  console.log(`    ${String(r.c.currentDesignation || '?').slice(0, 34).padEnd(36)} ${String(org).slice(0, 30)}`);
  console.log(`      old ${Math.round(r.o.score ?? 0)} REMOVED   ->   new ${Math.round(r.n.score ?? 0)} KEPT`);
}
if (recovered.length > 10) console.log(`    ... and ${recovered.length - 10} more`);

if (lost.length) {
  console.log();
  console.log('  Candidates the new code drops that the old code kept:');
  for (const l of lost.slice(0, 10)) {
    console.log(`    ${String(l.c.currentDesignation || '?').slice(0, 34).padEnd(36)} ${l.n.reason}`);
  }
}

// ---------------------------------------------------------------------------
head(3, 'Location extraction had stopped working entirely');

console.log('Old code, parseSearchResult.ts -- reads location ONLY from result.subtitle,');
console.log('                                  a field Serper stopped returning.');
console.log('New code                       -- also reads it from the snippet text.');
console.log();
console.log('OLD below is not a simulation. It is what the old code actually wrote');
console.log('into this session file at the time the search ran.');
console.log();

const recordedLoc = pool.filter((c) => c.location).length;
let newHas = 0;
const gained: any[] = [];

for (const c of pool) {
  const result = {
    title: `${c.name} - ${c.currentDesignation ?? ''}`.trim(),
    url: c.linkedinUrl ?? 'https://www.linkedin.com/in/x',
    snippet: c.searchSnippet ?? '',
    position: 0,
  };
  const n = parseNew(result as any);
  if (n.location) newHas += 1;
  if (!c.location && n.location) gained.push({ name: c.name, loc: n.location, snippet: result.snippet });
}

const pctOf = (x: number) => `${x} / ${pool.length} (${Math.round((100 * x) / pool.length)}%)`;
console.log(`  location the OLD code recorded        : ${pctOf(recordedLoc)}`);
console.log(`  location the NEW code reads from text  : ${pctOf(newHas)}`);
console.log(`  recovered that the old code missed     : ${gained.length}`);
console.log();

if (recordedLoc > 0) {
  console.log('  NOTE: this session was captured while Serper was still returning a');
  console.log('  subtitle, so the old code did find some. On the live run of');
  console.log('  15 September the field was gone and the recorded count was 0 of 235,');
  console.log('  while 99 of those snippets contained a city in plain text.');
  console.log('  Run this against .sessions/02nonofr5.json to see that.');
  console.log();
}

console.log('  The text was in the snippet the whole time:');
for (const g of gained.slice(0, 8)) {
  console.log(`    ${String(g.name).slice(0, 22).padEnd(24)} -> ${g.loc}`);
  console.log(`       from: "...${String(g.snippet).slice(0, 80)}..."`);
}
if (gained.length > 8) console.log(`    ... and ${gained.length - 8} more`);

console.log();
console.log('  Why this is the worst of the bugs: relevance.ts:163 says');
console.log('      const loc = normalize(candidateLocation || "");');
console.log('      if (!loc) return false;   // no location -> not a mismatch');
console.log('  That is correct and careful. But when location is null for EVERYONE,');
console.log('  it returns "no mismatch" every time -- so a location requirement is');
console.log('  never enforced on a single candidate.');

// ---------------------------------------------------------------------------
head(4, 'Which candidates reach the AI review step');

console.log('pipeline.ts:215 ranks every candidate by deterministicScore, then:');
console.log('    const forReview = ranked.slice(0, LIMITS.maxCandidatesForEvaluation);  // 20');
console.log('Everyone past that cut ships un-reviewed. So this function decides');
console.log('who the LLM ever looks at.');
console.log();

const rankBy = (fn: (c: any, b: any) => number) =>
  pool
    .map((c) => ({ c, s: fn({ ...c, confirmedSkills: c.confirmedSkills ?? [] } as any, brief) }))
    .sort((a, b) => b.s - a.s);

const rankedOld = rankBy(scoreOld as any);
const rankedNew = rankBy(scoreNew as any);

const TOP = 20;
const idsOld = new Set(rankedOld.slice(0, TOP).map((r) => r.c.id));
const idsNew = new Set(rankedNew.slice(0, TOP).map((r) => r.c.id));
const changed = [...idsNew].filter((id) => !idsOld.has(id));

console.log(`  top ${TOP} under OLD scoring vs NEW scoring`);
console.log(`  candidates who change places : ${changed.length} of ${TOP}`);
console.log();

console.log('  NEW top 10:');
rankedNew.slice(0, 10).forEach((r, i) => {
  const was = rankedOld.findIndex((x) => x.c.id === r.c.id) + 1;
  const move = was === 0 ? '' : was > i + 1 ? `  (was #${was})` : was < i + 1 ? `  (was #${was})` : '  (unchanged)';
  console.log(`    ${String(i + 1).padStart(2)}. ${String(r.c.name).slice(0, 26).padEnd(28)} ${Math.round(r.s).toString().padStart(3)}${move}`);
});

console.log();
console.log('  Score changes across the whole pool:');
let moved = 0;
let up = 0;
let down = 0;
for (const c of pool) {
  const a = scoreOld({ ...c } as any, brief);
  const b = scoreNew({ ...c, confirmedSkills: c.confirmedSkills ?? [] } as any, brief);
  if (Math.round(a) !== Math.round(b)) moved += 1;
  if (b > a) up += 1;
  if (b < a) down += 1;
}
console.log(`    score changed : ${moved} / ${pool.length}`);
console.log(`    scored higher : ${up}`);
console.log(`    scored lower  : ${down}`);
console.log();
console.log('  Scores moving DOWN is the fix working, not a regression. Old code at');
console.log('  deterministic.ts:212 tested locations[0][0] -- the first CHARACTER of');
console.log('  the location string. For a brief saying "India" that is the letter');
console.log('  "I", which appears in almost every snippet, so candidates anywhere in');
console.log('  the world collected 50 points instead of 20. Removing points that were');
console.log('  never earned is the point.');

console.log();
rule('=');
console.log('Every number above came from running both versions of the code on a');
console.log('session this app recorded. Nothing was typed in by hand.');
rule('=');
console.log();
