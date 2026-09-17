/**
 * Compares two recorded sessions side by side.
 *
 *   npx tsx eval/compare.ts <before.json> <after.json>
 *
 * Reads only saved sessions, so it costs nothing and anyone can re-run it to
 * check the numbers for themselves.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = { label: string; before: string; after: string; note?: string };

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('usage: npx tsx eval/compare.ts <before.json> <after.json>');
  process.exit(1);
}

const load = (p: string) => JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8'));
const a = load(beforePath);
const b = load(afterPath);

const pool = (s: any) => [...(s.candidates ?? []), ...(s.removedCandidates ?? [])];
const has = (s: any, key: string) =>
  pool(s).filter((c: any) => {
    const v = c[key];
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
const pct = (n: number, t: number) => (t ? `${n}/${t} (${Math.round((100 * n) / t)}%)` : '—');
const cov = (s: any, key: string) => pct(has(s, key), pool(s).length);

const skills = (s: any) => {
  const counts = new Map<string, number>();
  for (const c of pool(s)) for (const k of c.confirmedSkills ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts.size ? [...counts.entries()].map(([k, v]) => `${k} ${v}`).join(', ') : 'none';
};

const byLocation = (s: any) => {
  const here = /bengaluru|bangalore/i;
  const india = /bengaluru|bangalore|india|karnataka/i;
  const kept = s.candidates ?? [];
  const inCity = kept.filter((c: any) => c.location && here.test(c.location)).length;
  const elsewhere = kept.filter((c: any) => c.location && !india.test(c.location)).length;
  const unknown = kept.filter((c: any) => !c.location).length;
  return { inCity, elsewhere, unknown };
};

const la = byLocation(a);
const lb = byLocation(b);

const rows: Row[] = [
  { label: 'Raw search results', before: String(a.totalResultsFound), after: String(b.totalResultsFound) },
  { label: 'Unique candidates', before: String(a.totalUniqueBeforeFilter), after: String(b.totalUniqueBeforeFilter) },
  { label: 'Kept', before: String((a.candidates ?? []).length), after: String((b.candidates ?? []).length) },
  { label: 'Filtered out', before: String((a.removedCandidates ?? []).length), after: String((b.removedCandidates ?? []).length) },
  { label: '', before: '', after: '' },
  { label: 'Location extracted', before: cov(a, 'location'), after: cov(b, 'location'), note: 'was structurally 0' },
  { label: 'Employer extracted', before: cov(a, 'currentOrganization'), after: cov(b, 'currentOrganization') },
  { label: 'Experience extracted', before: cov(a, 'yearsExperience'), after: cov(b, 'yearsExperience') },
  { label: 'Skills confirmed', before: cov(a, 'confirmedSkills'), after: cov(b, 'confirmedSkills') },
  { label: '', before: '', after: '' },
  { label: 'Kept — in target city', before: String(la.inCity), after: String(lb.inCity) },
  // Shown as a fraction of the candidates whose location is actually known.
  // A bare "0" reads as "filtering worked" when in truth nothing was known.
  {
    label: 'Kept — ELSEWHERE',
    before: `${la.elsewhere} of ${la.inCity + la.elsewhere} known`,
    after: `${lb.elsewhere} of ${lb.inCity + lb.elsewhere} known`,
    note: 'brief names one city',
  },
  { label: 'Kept — location unknown', before: String(la.unknown), after: String(lb.unknown) },
];

const w = { l: 26, b: 16, a: 16 };
const pad = (s: string, n: number) => s.padEnd(n);
const line = (ch = '─') => console.log(ch.repeat(w.l + w.b + w.a + 6));

console.log(`\nBEFORE  ${beforePath}`);
console.log(`AFTER   ${afterPath}`);
console.log(`BRIEF   ${String(a.rawRequirement).split('\n')[0].slice(0, 70)}`);
line('═');
console.log(`${pad('', w.l)}  ${pad('BEFORE', w.b)}  ${pad('AFTER', w.a)}`);
line();
for (const r of rows) {
  if (!r.label) { line(); continue; }
  const note = r.note ? `   <- ${r.note}` : '';
  console.log(`${pad(r.label, w.l)}  ${pad(r.before, w.b)}  ${pad(r.after, w.a)}${note}`);
}
line('═');

console.log('\nSKILLS CONFIRMED');
console.log(`  before  ${skills(a)}`);
console.log(`  after   ${skills(b)}`);

console.log('\nWHY CANDIDATES WERE DROPPED');
const reasons = (s: any) => {
  const counts = new Map<string, number>();
  for (const c of s.removedCandidates ?? []) {
    const r = (c.relevanceReason ?? '').toLowerCase();
    const key = r.includes('outside') ? 'location mismatch'
      : r.includes('no job title') ? 'no title extracted'
      : r.includes('recognised equivalent') ? 'title unrelated'
      : r.includes('yrs vs') ? 'experience out of range'
      : r.includes('scored') ? 'below threshold 55'
      : 'other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
const ra = reasons(a);
const rb = reasons(b);
for (const key of new Set([...ra.keys(), ...rb.keys()])) {
  console.log(`  ${pad(key, 24)}  ${pad(String(ra.get(key) ?? 0), 8)}  ${rb.get(key) ?? 0}`);
}

console.log('\nRead this honestly: kept can rise while filtering gets STRICTER, because');
console.log('the pool grew once failed requests stopped being discarded. The line that');
console.log('shows filtering actually improved is "Kept - ELSEWHERE".\n');
