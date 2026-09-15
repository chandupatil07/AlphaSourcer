/**
 * Replay harness — measures the current scoring pipeline against a recorded
 * search session, using the session's real candidates.
 *
 *   npx tsx eval/replay.ts [sessionFile]     (default: b.json)
 *
 * Costs nothing: no Serper credits, no Groq tokens, no network. It reads a
 * saved session, pushes every candidate it contains (kept AND removed) back
 * through today's assessRelevance() and calculateDeterministicScore(), and
 * reports what the pipeline does with them.
 *
 * Why this exists: "accuracy is poor" is a feeling. This turns it into numbers
 * that can be compared before and after a change. Run it, note the figures,
 * make one change, run it again.
 *
 * Caveat, stated up front: a recorded session is a fixed set of candidates
 * produced by whatever queries ran that day. This measures SCORING AND
 * FILTERING only. It cannot tell us about a great candidate the search never
 * retrieved — that needs a live run with labelled results.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessRelevance } from '@/lib/candidates/relevance';
import { calculateDeterministicScore } from '@/lib/scoring/deterministic';
import { FINAL_SCORE_WEIGHTS } from '@/config/scoring';

const file = process.argv[2] ?? 'b.json';
const session = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
const brief = session.searchBrief;

const all = [...(session.candidates ?? []), ...(session.removedCandidates ?? [])];
if (all.length === 0) {
  console.error(`${file} contains no candidates (status: ${session.status}). Use a completed session.`);
  process.exit(1);
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
const band = (s: number) =>
  s >= 90 ? 'excellent' : s >= 75 ? 'strong' : s >= 60 ? 'potential' : 'low';

console.log(`\nSession : ${file}`);
console.log(`Brief   : ${String(session.rawRequirement).split('\n')[0]}`);
console.log(`Recorded: ${session.totalUniqueBeforeFilter} unique -> ${(session.candidates ?? []).length} kept`);
console.log(`Replaying ${all.length} candidates through current code\n`);

const rows = all.map((c: any) => {
  const verdict = assessRelevance(c, brief);
  const det = calculateDeterministicScore(c, brief);
  // contextualScore falls back to the deterministic score whenever AI review
  // is skipped or rate-limited, so final === det in that case.
  const final = det * FINAL_SCORE_WEIGHTS.deterministic + det * FINAL_SCORE_WEIGHTS.contextual;
  return {
    name: c.name as string,
    designation: (c.currentDesignation ?? null) as string | null,
    url: c.linkedinUrl as string,
    keep: verdict.keep,
    reason: verdict.reason,
    relevanceScore: verdict.score ?? 0,
    final,
    band: band(final),
  };
});

const kept = rows.filter((r) => r.keep);
const dropped = rows.filter((r) => !r.keep);

console.log('=== 1. FUNNEL ===');
console.log(`  kept    ${kept.length}/${rows.length} (${pct(kept.length, rows.length)})`);
console.log(`  dropped ${dropped.length}/${rows.length} (${pct(dropped.length, rows.length)})`);

const classify = (reason: string) => {
  const s = reason.toLowerCase();
  if (s.includes('outside')) return 'location mismatch';
  if (s.includes('no job title')) return 'no title extracted';
  if (s.includes('recognised equivalent')) return 'title unrelated (hard cut)';
  if (s.includes('yrs vs')) return 'experience out of range (hard cut)';
  if (s.includes('scored')) return 'below threshold 55';
  return 'other';
};
const byReason = new Map<string, number>();
for (const d of dropped) {
  const k = classify(d.reason);
  byReason.set(k, (byReason.get(k) ?? 0) + 1);
}
console.log('\n=== 2. WHY CANDIDATES WERE DROPPED ===');
[...byReason.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k.padEnd(32)} ${String(v).padStart(3)} (${pct(v, dropped.length)})`));

// Candidates rejected only for falling under the weighted threshold, and by
// how little. A cluster just below the line means the threshold is doing more
// work than anyone chose for it to do.
const near = dropped
  .map((d) => ({ d, m: /scored (\d+)\/100/.exec(d.reason) }))
  .filter((x) => x.m)
  .map((x) => ({ ...x.d, score: Number(x.m![1]) }))
  .sort((a, b) => b.score - a.score);

console.log('\n=== 3. NEAR MISSES (KEEP_THRESHOLD = 55) ===');
console.log(`  within 10 points of the cut: ${near.filter((n) => n.score >= 45).length}`);
near.slice(0, 10).forEach((n) =>
  console.log(`   ${String(n.score).padStart(3)}  ${(n.designation ?? '?').slice(0, 56)}`));

// The list is ordered by relevanceScore (pipeline.ts) but the badge and number
// shown to the recruiter come from finalScore. Where those disagree, the UI
// cannot explain its own ordering.
console.log('\n=== 4. DISPLAYED SCORE vs DISPLAYED ORDER ===');
const ordered = [...kept].sort((a, b) => b.relevanceScore - a.relevanceScore || b.final - a.final);
let inversions = 0;
for (let i = 0; i < ordered.length; i++) {
  for (let j = i + 1; j < ordered.length; j++) {
    if (ordered[j].final > ordered[i].final + 0.5) inversions++;
  }
}
const pairs = (ordered.length * (ordered.length - 1)) / 2;
console.log(`  inverted pairs: ${inversions}/${pairs} (${pct(inversions, pairs)})`);
console.log('\n  top 10 as the recruiter sees them:');
console.log(`    ${'#'.padStart(2)}  ${'badge'.padEnd(10)} ${'score'.padStart(5)}  ${'rank-key'.padStart(8)}  name`);
ordered.slice(0, 10).forEach((r, i) =>
  console.log(
    `    ${String(i + 1).padStart(2)}  ${r.band.padEnd(10)} ${r.final.toFixed(0).padStart(5)}  ${String(r.relevanceScore).padStart(8)}  ${r.name.slice(0, 30)}`
  ));

console.log('\n=== 5. URL / DEDUP ===');
const hosts = new Map<string, number>();
const paths = new Map<string, Set<string>>();
for (const r of rows) {
  try {
    const u = new URL(r.url);
    hosts.set(u.hostname, (hosts.get(u.hostname) ?? 0) + 1);
    const key = u.pathname.replace(/\/$/, '').toLowerCase();
    if (!paths.has(key)) paths.set(key, new Set());
    paths.get(key)!.add(u.origin);
  } catch { /* malformed url */ }
}
console.log('  hostnames:', [...hosts.entries()].map(([h, n]) => `${h}=${n}`).join('  '));
const collisions = [...paths.values()].filter((s) => s.size > 1).length;
console.log(`  same profile path under more than one hostname: ${collisions}`);
console.log('  (normalizeLinkedInUrl keys on origin+path, so any collision here is a duplicate person)');

// How much evidence actually exists per candidate. A dimension we almost never
// observe cannot meaningfully contribute to a score.
console.log('\n=== 6. EVIDENCE COVERAGE ===');
const cov = (label: string, p: (c: any) => boolean) => {
  const n = all.filter(p).length;
  console.log(`  ${label.padEnd(16)} ${String(n).padStart(3)}/${all.length} (${pct(n, all.length)})`);
};
cov('designation', (c) => !!c.currentDesignation);
cov('organization', (c) => !!c.currentOrganization);
cov('location', (c) => !!c.location);
cov('yearsExperience', (c) => c.yearsExperience != null);
console.log('');
