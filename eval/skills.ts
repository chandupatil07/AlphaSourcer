/**
 * Shows what the must-have skill score -- the heaviest weight in the
 * Technology profile, 35% -- actually returns on a recorded run.
 *
 *   npx tsx eval/skills.ts <session.json>
 *
 * This exists because the score once looked evidence-aware and was not. It
 * divided the must-have skills found by the must-have skills "checkable", but
 * computed "checkable" with the same predicate as "found" -- so the ratio was
 * 1 by construction and the whole weight returned exactly two values: a
 * neutral 50 when nothing was found, and a perfect 100 the moment any single
 * skill appeared. One skill in three scored identically to three in three.
 *
 * Nothing in the type system or the build could catch that. Only running the
 * function over real candidates and printing every value it produced could.
 * So that is what this does, and it is worth re-running after any change to
 * the skill score: if this table ever collapses back to two rows, the
 * denominator has gone wrong again.
 *
 * Costs nothing: no network, no Serper credits, no Groq tokens.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { calculateSkillScore } from '@/lib/scoring/deterministic';

const sessionPath = process.argv[2];
if (!sessionPath) {
  console.error('usage: npx tsx eval/skills.ts <session.json>');
  process.exit(1);
}

const session = JSON.parse(readFileSync(resolve(process.cwd(), sessionPath), 'utf8'));
const brief = session.searchBrief;
const pool: any[] = [...(session.candidates ?? []), ...(session.removedCandidates ?? [])];
const must: string[] = brief.mustHaveSkills ?? [];
const good: string[] = brief.goodToHaveSkills ?? [];

const score = (c: any) =>
  calculateSkillScore(c.currentDesignation, c.searchSnippet ?? '', must, good, c.confirmedSkills ?? []);

const line = (ch = '-') => console.log(ch.repeat(60));

console.log();
console.log(`SESSION     ${sessionPath}`);
console.log(`must-have   ${must.join(', ') || '(none)'}`);
console.log(`good-to-have ${good.join(', ') || '(none)'}`);
console.log(`candidates  ${pool.length}`);
line('=');

const dist = new Map<number, number>();
for (const c of pool) {
  const s = Math.round(score(c));
  dist.set(s, (dist.get(s) ?? 0) + 1);
}
console.log();
console.log('EVERY VALUE THE SKILL SCORE PRODUCES ON THIS POOL');
for (const [s, n] of [...dist.entries()].sort((a, b) => b[0] - a[0])) {
  console.log(`  ${String(s).padStart(3)}   ${'#'.repeat(Math.min(40, Math.ceil(n / 5)))} ${n}`);
}
if (dist.size <= 2 && must.length > 1) {
  console.log();
  console.log('  WARNING: only two distinct values. Candidates who evidence one');
  console.log('  required skill are scoring the same as candidates who evidence');
  console.log('  all of them. Check the denominator in calculateSkillScore.');
}

console.log();
console.log('HOW MANY REQUIRED SKILLS WERE EVIDENCED  ->  WHAT THEY SCORE');
const buckets = new Map<number, { n: number; scores: Set<number> }>();
for (const c of pool) {
  const content = `${c.currentDesignation || ''} ${c.searchSnippet ?? ''}`;
  const confirmed = new Set((c.confirmedSkills ?? []).map((s: string) => s.trim().toLowerCase()));
  const found = must.filter((k) => {
    if (confirmed.has(k.trim().toLowerCase())) return true;
    const escaped = k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#]|$)`, 'i').test(content);
  }).length;
  if (!buckets.has(found)) buckets.set(found, { n: 0, scores: new Set() });
  const b = buckets.get(found)!;
  b.n += 1;
  b.scores.add(Math.round(score(c)));
}
for (const [found, b] of [...buckets.entries()].sort((a, b2) => a[0] - b2[0])) {
  const scores = [...b.scores].sort((x, y) => x - y).join(' / ');
  console.log(`  ${found} of ${must.length}   ${String(b.n).padStart(3)} candidates   ->  ${scores}`);
}

console.log();
console.log('SKILLS CONFIRMED BY SEARCH PROVENANCE (not just visible in the snippet)');
const confirmedCount = pool.filter((c) => (c.confirmedSkills?.length ?? 0) > 0).length;
console.log(`  ${confirmedCount} / ${pool.length} candidates have at least one skill confirmed by the query that found them.`);
console.log();
console.log('  The rest are judged on ~160 characters of snippet, where a real');
console.log('  skill is usually simply not mentioned. That is a recall ceiling on');
console.log('  the evidence, not on the scoring -- raising it needs more probe');
console.log('  queries or a per-candidate check, both of which cost credits.');
console.log();
line('=');
console.log();
