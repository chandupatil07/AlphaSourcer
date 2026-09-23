import { Candidate, SearchBrief } from '@/types/index';
import { countryOfPlace } from '@/lib/geo/places';

/**
 * Answers one question about a finished shortlist: did it actually deliver
 * what the requirement asked for?
 *
 * Until now the results page showed scores and nothing else, so a requirement
 * could name Django and the tool could return a list where almost nobody
 * evidenced Django -- and the screen would look identical either way. That is
 * exactly how a scoring bug survived: the skill score awarded full marks on
 * one skill out of three for weeks, and no screen in the product would have
 * shown it.
 *
 * Three states, never two. "Not evidenced" is not the same as "does not have
 * it" -- a Google snippet is around 160 characters of name, headline and city
 * and usually mentions no skills at all. Reporting unknown as a failure would
 * be the same mistake the scoring used to make, so unknown is counted and
 * labelled as unknown.
 */
export type CoverageRow = {
  id: string;
  /** The requirement itself, e.g. "Django" or "Bangalore". */
  requirement: string;
  kind: 'skill' | 'location' | 'experience' | 'title';
  /** Proven present -- a search that demanded it returned the profile. */
  confirmed: number;
  /** Visible in the profile headline or snippet. */
  visible: number;
  /** Nothing in the available text either way. Unknown, not absent. */
  unknown: number;
  /** Positively contradicted, e.g. a profile whose own city is elsewhere. */
  contradicted: number;
  total: number;
  /** Plain-language reading of the row, shown under it. */
  note: string;
};

export type BriefCoverage = {
  rows: CoverageRow[];
  /** Candidates evidencing every must-have skill. */
  allSkills: number;
  total: number;
  /** At least one required skill is evidenced for under a quarter of the list. */
  thinSkillEvidence: boolean;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word match, mirroring `skillAppearsIn` in the scorer. If these two
 * ever disagree the panel would report a coverage the score did not use.
 */
function appearsIn(text: string, term: string): boolean {
  const clean = term.trim();
  if (!clean) return false;
  return new RegExp(`(^|[^a-z0-9+#.])${escapeRegExp(clean)}([^a-z0-9+#]|$)`, 'i').test(text);
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The honest reading of a skill row, in the order that matters: how thin the
 * evidence is first, what the number means second. A row saying only "4
 * profiles were proven to have Django" reads like good news beside a bar that
 * is almost entirely empty.
 */
function skillNote(skill: string, confirmed: number, visible: number, total: number): string {
  const evidenced = confirmed + visible;

  if (evidenced === 0) {
    return `Nothing in this search evidenced ${skill} for anyone on the list. That is not proof they lack it — no search demanded the term, and a snippet rarely mentions skills. Putting ${skill} in the requirement makes the tool search for it directly.`;
  }

  const share = Math.round((evidenced / total) * 100);
  const proven =
    confirmed > 0
      ? ` ${plural(confirmed, 'was', 'were')} returned by a search that demanded "${skill}", which proves the term is on the profile.`
      : ' None of them came from a search that demanded the term, so this is what the snippet happened to show.';

  const lead =
    share < 25
      ? `Only ${evidenced} of ${total} (${share}%) show ${skill} at all.`
      : `${evidenced} of ${total} (${share}%) evidence ${skill}.`;

  // The "what to do about it" line is deliberately NOT repeated here. With
  // three required skills it appeared three times in a row and read as
  // filler; the panel states it once instead.
  return `${lead}${proven}`;
}

export function buildBriefCoverage(
  candidates: Candidate[],
  brief: SearchBrief | null
): BriefCoverage | null {
  if (!brief || candidates.length === 0) return null;

  const total = candidates.length;
  const rows: CoverageRow[] = [];

  // ---- Job title -----------------------------------------------------------
  const acceptedTitles = [brief.primaryTitle, ...brief.alternativeTitles].filter(
    (t): t is string => Boolean(t && t.trim())
  );
  if (acceptedTitles.length > 0) {
    let visible = 0;
    let unknown = 0;
    for (const c of candidates) {
      const title = c.currentDesignation ?? '';
      if (!title.trim()) unknown += 1;
      else if (acceptedTitles.some((t) => title.toLowerCase().includes(t.toLowerCase()))) visible += 1;
      else unknown += 1;
    }
    rows.push({
      id: 'title',
      requirement: brief.primaryTitle ?? acceptedTitles[0],
      kind: 'title',
      confirmed: 0,
      visible,
      unknown,
      contradicted: 0,
      total,
      note:
        unknown > 0
          ? `${plural(unknown, 'headline holds', 'headlines hold')} a related title rather than an exact one — adjacent roles are kept on purpose.`
          : 'Every headline names an accepted title.',
    });
  }

  // ---- Location ------------------------------------------------------------
  if (brief.locations.length > 0) {
    const wanted = [...brief.locations, ...(brief.locationVariants ?? [])]
      .map((l) => l.trim())
      .filter(Boolean);
    const wantedCountries = new Set(
      wanted.map((w) => countryOfPlace(w)).filter((c): c is string => Boolean(c))
    );

    let visible = 0;
    let unknown = 0;
    let contradicted = 0;
    for (const c of candidates) {
      const loc = (c.location ?? '').trim();
      if (!loc) {
        unknown += 1;
        continue;
      }
      if (wanted.some((w) => loc.toLowerCase().includes(w.toLowerCase()))) {
        visible += 1;
        continue;
      }
      const country = countryOfPlace(loc);
      if (country && wantedCountries.size > 0 && !wantedCountries.has(country)) contradicted += 1;
      else unknown += 1;
    }
    rows.push({
      id: 'location',
      requirement: brief.locations.join(' / '),
      kind: 'location',
      confirmed: 0,
      visible,
      unknown,
      contradicted,
      total,
      note:
        contradicted > 0
          ? `${plural(contradicted, 'profile states', 'profiles state')} a location outside the requested country. Worth reviewing.`
          : `${plural(unknown, 'profile does', 'profiles do')} not state a city anywhere in the text — kept, because no city is not the wrong city.`,
    });
  }

  // ---- Must-have skills ----------------------------------------------------
  for (const skill of brief.mustHaveSkills) {
    let confirmed = 0;
    let visible = 0;
    let unknown = 0;
    for (const c of candidates) {
      const isConfirmed = (c.confirmedSkills ?? []).some(
        (s) => s.trim().toLowerCase() === skill.trim().toLowerCase()
      );
      if (isConfirmed) {
        confirmed += 1;
        continue;
      }
      const text = `${c.currentDesignation ?? ''} ${c.searchSnippet ?? ''}`;
      if (appearsIn(text, skill)) visible += 1;
      else unknown += 1;
    }
    rows.push({
      id: `skill:${skill}`,
      requirement: skill,
      kind: 'skill',
      confirmed,
      visible,
      unknown,
      contradicted: 0,
      total,
      note: skillNote(skill, confirmed, visible, total),
    });
  }

  // ---- Experience ----------------------------------------------------------
  if (brief.minExperience !== null || brief.maxExperience !== null) {
    const min = brief.minExperience ?? 0;
    const max = brief.maxExperience ?? Number.POSITIVE_INFINITY;
    let visible = 0;
    let unknown = 0;
    let contradicted = 0;
    for (const c of candidates) {
      const years = c.yearsExperience;
      if (years === null || years === undefined) unknown += 1;
      else if (years >= min && years <= max) visible += 1;
      else contradicted += 1;
    }
    rows.push({
      id: 'experience',
      requirement: `${min}–${brief.maxExperience ?? 'any'} years`,
      kind: 'experience',
      confirmed: 0,
      visible,
      unknown,
      contradicted,
      total,
      note:
        unknown === total
          ? 'No profile in this list states its years of experience in the indexed text, so this requirement could not be checked for anyone. Seniority came from the job title instead.'
          : `${plural(unknown, 'profile does', 'profiles do')} not state a number of years, so the range was judged from the title for those.`,
    });
  }

  // ---- Candidates meeting every skill at once ------------------------------
  let allSkills = 0;
  if (brief.mustHaveSkills.length > 0) {
    for (const c of candidates) {
      const text = `${c.currentDesignation ?? ''} ${c.searchSnippet ?? ''}`;
      const confirmed = new Set((c.confirmedSkills ?? []).map((s) => s.trim().toLowerCase()));
      const every = brief.mustHaveSkills.every(
        (s) => confirmed.has(s.trim().toLowerCase()) || appearsIn(text, s)
      );
      if (every) allSkills += 1;
    }
  }

  const thinSkillEvidence = rows.some(
    (r) => r.kind === 'skill' && r.total > 0 && (r.confirmed + r.visible) / r.total < 0.25
  );

  return { rows, allSkills, total, thinSkillEvidence };
}
