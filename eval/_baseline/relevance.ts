import { SearchBrief } from '@/types/index';

export type RelevanceTier = 'core' | 'adjacent' | 'skill' | 'excluded';

export interface RelevanceVerdict {
  tier: RelevanceTier;
  /** e.g. "Core - Ontologist" — the label shown in the export. */
  tierLabel: string;
  /** Short human explanation for the Shortlist/Removed sheets. */
  reason: string;
  keep: boolean;
  /** Weighted total, 0-100, used for ranking. */
  score?: number;
}

// Seniority and filler words carry no signal about *what* the role is.
const STOPWORDS = new Set([
  'senior', 'sr', 'junior', 'jr', 'lead', 'principal', 'staff', 'chief', 'head',
  'associate', 'assistant', 'the', 'and', 'of', 'at', 'for', 'in', 'a', 'an',
  'i', 'ii', 'iii', 'iv', '1', '2', '3', '4', 'level', 'grade',
]);

/** Compound role words that Google renders inconsistently. */
const COMPOUND_FIXES: Array<[RegExp, string]> = [
  [/\bback[\s-]?end\b/g, 'backend'],
  [/\bfront[\s-]?end\b/g, 'frontend'],
  [/\bfull[\s-]?stack\b/g, 'fullstack'],
  [/\bdev[\s-]?ops\b/g, 'devops'],
  [/\bmachine[\s-]?learning\b/g, 'ml'],
  [/\bdata[\s-]?science\b/g, 'datascience'],
];

// Words that describe the same job function, so a title match should still count.
const SYNONYMS: Record<string, string> = {
  developer: 'engineer',
  programmer: 'engineer',
  dev: 'engineer',
  engineering: 'engineer',
  architect: 'engineer',
};

export function normalize(text: string): string {
  let out = ` ${(text || '').toLowerCase()} `;
  for (const [pattern, replacement] of COMPOUND_FIXES) out = out.replace(pattern, replacement);
  return out.replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function tokenize(text: string): Set<string> {
  const tokens = normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => SYNONYMS[t] ?? t);
  return new Set(tokens);
}

/**
 * Each accepted title is kept as its own token set. Matching requires EVERY
 * token of some title to be present — flattening them into one pool let a
 * single shared word like "engineer" admit an unrelated profession.
 */
function titleMatchers(brief: SearchBrief): {
  core: Set<string>;
  alternates: Array<{ label: string; tokens: Set<string> }>;
} {
  const core = tokenize(brief.primaryTitle || '');
  const alternates = brief.alternativeTitles
    .map((label) => ({ label, tokens: tokenize(label) }))
    .filter((t) => t.tokens.size > 0);
  return { core, alternates };
}

/**
 * Same word, different ending: ontology/ontologist, taxonomy/taxonomist. A
 * shared prefix of six or more characters is specific enough to be safe —
 * "data" and "database" share only four and stay distinct.
 */
const MIN_STEM = 6;

function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < MIN_STEM) return false;
  return longer.startsWith(shorter.slice(0, MIN_STEM)) && shorter.startsWith(shorter.slice(0, MIN_STEM));
}

function hasToken(titleSet: Set<string>, token: string): boolean {
  if (titleSet.has(token)) return true;
  for (const candidate of titleSet) {
    if (sameStem(candidate, token)) return true;
  }
  return false;
}

/** True when every distinctive word of `required` appears in `titleSet`. */
function containsAllTokens(titleSet: Set<string>, required: Set<string>): boolean {
  if (required.size === 0) return false;
  for (const token of required) {
    if (!hasToken(titleSet, token)) return false;
  }
  return true;
}

// Cities that imply their country, so "Bangalore" in a brief still accepts a
// profile listed as "Bengaluru, Karnataka, India".
const CITY_COUNTRY: Record<string, string> = {
  bangalore: 'india', bengaluru: 'india', mumbai: 'india', bombay: 'india',
  delhi: 'india', gurgaon: 'india', gurugram: 'india', noida: 'india',
  hyderabad: 'india', chennai: 'india', pune: 'india', kolkata: 'india',
  ahmedabad: 'india', jaipur: 'india', kochi: 'india', indore: 'india',
  london: 'united kingdom', manchester: 'united kingdom',
  singapore: 'singapore', dubai: 'united arab emirates',
  berlin: 'germany', munich: 'germany', paris: 'france',
  toronto: 'canada', vancouver: 'canada', sydney: 'australia', melbourne: 'australia',
};

const CITY_ALIASES: Record<string, string[]> = {
  bangalore: ['bengaluru'], bengaluru: ['bangalore'],
  mumbai: ['bombay'], bombay: ['mumbai'],
  gurgaon: ['gurugram'], gurugram: ['gurgaon'],
};

/**
 * Accepted location terms, and whether the brief is city-specific. Naming a
 * city means that city — a brief for Bangalore should not return Chennai.
 */
function acceptedLocations(brief: SearchBrief): { terms: Set<string>; cityLevel: boolean } {
  const terms = new Set<string>();
  let cityLevel = false;

  for (const raw of [...brief.locations, ...brief.locationVariants]) {
    const loc = normalize(raw);
    if (!loc) continue;
    terms.add(loc);

    if (CITY_COUNTRY[loc]) {
      // A recognised city: demand the city itself, plus its known aliases.
      cityLevel = true;
      for (const alias of CITY_ALIASES[loc] ?? []) terms.add(alias);
    } else {
      // Treat as a region/country: also accept cities known to sit inside it.
      for (const [city, country] of Object.entries(CITY_COUNTRY)) {
        if (country === loc) terms.add(city);
      }
    }
  }

  return { terms, cityLevel };
}

/**
 * Only rejects a location we can positively identify as elsewhere. An unknown
 * or unparseable location is never treated as a mismatch.
 */
export function locationMismatch(
  candidateLocation: string | null | undefined,
  brief: SearchBrief
): boolean {
  const { terms, cityLevel } = acceptedLocations(brief);
  if (terms.size === 0) return false;

  const loc = normalize(candidateLocation || '');
  if (!loc) return false;

  for (const term of terms) {
    if (loc.includes(term)) return false;
  }

  // Country-level briefs still accept a profile that names only its city.
  if (!cityLevel) {
    for (const part of loc.split(' ')) {
      const country = CITY_COUNTRY[part];
      if (country && terms.has(country)) return false;
    }
  }

  return true;
}

// Words that identify the sector when a brief names an industry rather than
// listing every employer in it.
const INDUSTRY_TERMS: Record<string, string[]> = {
  recruitment: ['recruit', 'staffing', 'talent', 'hiring', 'headhunt', 'placement', 'manpower'],
  staffing: ['staffing', 'recruit', 'talent', 'manpower', 'workforce'],
  hrtech: ['hrtech', 'hr tech', 'hrms', 'hcm', 'people ops', 'human resource', 'hr software', 'ats'],
  saas: ['saas', 'software', 'platform', 'product'],
  fintech: ['fintech', 'payments', 'lending', 'banking'],
};

function industryTerms(industries: string[]): string[] {
  const terms = new Set<string>();
  for (const raw of industries) {
    const key = normalize(raw).replace(/\s+/g, '');
    terms.add(normalize(raw));
    for (const term of INDUSTRY_TERMS[key] ?? []) terms.add(term);
  }
  return [...terms].filter(Boolean);
}

// Words indicating someone is currently studying, which is how a student's
// profile identifies itself when it carries no job title at all.
const STUDENT_MARKERS = [
  'student', 'pursuing', 'undergraduate', 'aspiring', 'final year', 'fresher',
  'graduate 20', 'batch of', 'class of',
];

/** Seniority words, used when a brief constrains years of experience. */
const SENIOR_MARKERS = ['senior', 'sr', 'lead', 'principal', 'staff', 'head', 'director', 'vp', 'vice president', 'chief', 'manager', 'architect'];
const JUNIOR_MARKERS = ['intern', 'trainee', 'fresher', 'junior', 'jr', 'associate', 'graduate', 'entry'];

/** Tolerates singular/plural drift: brief says "knowledge graphs", title says "knowledge graph". */
function containsSkill(text: string, skill: string): boolean {
  const s = normalize(skill);
  if (s.length < 2) return false;
  if (text.includes(s)) return true;

  const singular = s.endsWith('s') ? s.slice(0, -1) : s;
  const plural = s.endsWith('s') ? s : `${s}s`;
  return text.includes(singular) || text.includes(plural);
}

function skillHits(haystack: string, skills: string[]): string[] {
  const text = normalize(haystack);
  return skills.filter((skill) => containsSkill(text, skill));
}

/** Common role acronyms, so "BGV" and "Background Verification" unify. */
const ACRONYM_EXPANSIONS: Record<string, string> = {
  bgv: 'background verification',
  sdr: 'sales development representative',
  bdr: 'business development representative',
  bde: 'business development executive',
  sre: 'site reliability engineer',
  qa: 'quality assurance',
  ta: 'talent acquisition',
  hr: 'human resources',
  pm: 'product manager',
  ml: 'machine learning',
  kyc: 'know your customer',
};

/** Builds an initialism: "Background Verification Specialist" -> "bvs". */
function initialism(text: string): string {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map((w) => w[0])
    .join('');
}

/** Appends the long form of any acronym present, so both forms are comparable. */
function withExpansions(text: string): string {
  let out = ` ${normalize(text)} `;
  for (const [short, long] of Object.entries(ACRONYM_EXPANSIONS)) {
    if (out.includes(` ${short} `)) out += ` ${long} `;
  }
  return out.trim();
}

const WEIGHTS = { title: 40, employer: 30, experience: 20, domain: 10 };
const KEEP_THRESHOLD = 55;

/**
 * How closely the job title matches, 0-100.
 *
 * Containment counts in either direction: "Verification Specialist" and
 * "Background Verification Specialist" name the same job, and demanding an
 * exact match was discarding people who plainly qualified.
 */
function scoreTitle(designation: string, brief: SearchBrief): { score: number; note: string } {
  const titleSet = tokenize(withExpansions(designation));
  const { core, alternates } = titleMatchers(brief);
  const coreArr = [...core];

  if (coreArr.length > 0 && containsAllTokens(titleSet, core)) {
    return { score: 100, note: 'exact title' };
  }

  const matched = coreArr.filter((t) => hasToken(titleSet, t));
  if (coreArr.length > 0 && matched.length >= Math.ceil(coreArr.length * 0.6)) {
    return { score: 85, note: `partial title (${matched.join(', ')})` };
  }

  // Acronym in either direction: "RMG (BGV)" against "Background Verification".
  const target = normalize(brief.primaryTitle || '');
  const targetInitials = initialism(target);
  const expanded = withExpansions(designation);
  if (
    (targetInitials.length >= 2 && titleSet.has(targetInitials)) ||
    (target.length > 3 && expanded.includes(target))
  ) {
    return { score: 85, note: 'acronym match' };
  }

  const alt = alternates.find((a) => containsAllTokens(titleSet, a.tokens));
  if (alt) return { score: 75, note: `equivalent to ${alt.label}` };

  if (coreArr.some((t) => hasToken(titleSet, t))) {
    return { score: 35, note: 'weak title overlap' };
  }

  return { score: 0, note: 'unrelated title' };
}

function scoreEmployer(
  candidate: { currentOrganization: string | null; searchSnippet: string },
  brief: SearchBrief
): { score: number; note: string } {
  const named = brief.preferredCompanies;
  const peers = brief.inferredCompanies ?? [];
  const sectors = industryTerms(brief.preferredIndustries);

  if (named.length === 0 && peers.length === 0 && sectors.length === 0) {
    return { score: 60, note: '' };
  }

  const context = `${normalize(candidate.currentOrganization || '')} ${normalize(
    candidate.searchSnippet
  )}`;

  const hit = named.find((c) => normalize(c).length > 2 && context.includes(normalize(c)));
  if (hit) return { score: 100, note: `at ${hit}` };

  const peer = peers.find((c) => normalize(c).length > 2 && context.includes(normalize(c)));
  if (peer) return { score: 80, note: `at ${peer}` };

  const sector = sectors.find((t) => t.length > 2 && context.includes(t));
  if (sector) return { score: 70, note: `${brief.preferredIndustries[0] ?? sector} background` };

  // Unknown is neutral: never a free pass, never a rejection.
  if (!candidate.currentOrganization) return { score: 50, note: 'employer not listed' };

  return { score: 10, note: `at ${candidate.currentOrganization}` };
}

function scoreExperience(
  years: number | null | undefined,
  brief: SearchBrief
): { score: number; note: string } {
  const wantsEntry = brief.studentStatus === 'pursuing';
  const { minExperience, maxExperience } = brief;

  if (minExperience === null && maxExperience === null && !wantsEntry) {
    return { score: 60, note: '' };
  }
  if (years == null) return { score: 60, note: '' };

  const lo = wantsEntry ? 0 : minExperience ?? 0;
  const hi = wantsEntry ? 1.5 : maxExperience ?? 45;

  // Half a year of slack: profiles round their own tenure.
  if (years >= lo - 0.5 && years <= hi + 0.5) {
    return { score: 100, note: `${years.toFixed(1)} yrs` };
  }

  const drift = years > hi ? years - hi : lo - years;
  if (drift <= 1.5) return { score: 55, note: `${years.toFixed(1)} yrs, just outside` };

  // Positively identified as far outside a stated range. Like location, this is
  // evidence of a mismatch rather than absence of evidence, so it is decisive.
  if (drift > 2) {
    return { score: -1, note: `${years.toFixed(1)} yrs vs ${lo}-${hi} required` };
  }

  return { score: 10, note: `${years.toFixed(1)} yrs vs ${lo}-${hi} wanted` };
}

function scoreDomain(
  candidate: { currentDesignation: string | null; searchSnippet: string },
  brief: SearchBrief
): number {
  const required = [...brief.mustHaveSkills, ...brief.educationQualifications];
  if (required.length === 0) return 60;

  const text = normalize(`${candidate.currentDesignation ?? ''} ${candidate.searchSnippet}`);
  const hits = required.filter((r) => {
    const n = normalize(r);
    if (n.length < 2) return false;
    const singular = n.endsWith('s') ? n.slice(0, -1) : n;
    return text.includes(n) || text.includes(singular);
  });

  return Math.round((hits.length / required.length) * 100);
}

/**
 * Weighs the available signals instead of chaining pass/fail gates. Strong
 * evidence in one dimension can carry a weak signal in another, which is how a
 * recruiter reads a profile — and it stops one missing field from discarding an
 * otherwise obvious match.
 *
 * Location stays a hard gate: a requested geography is a requirement.
 */
export function assessRelevance(
  candidate: {
    name: string;
    currentDesignation: string | null;
    currentOrganization: string | null;
    location?: string | null;
    yearsExperience?: number | null;
    searchSnippet: string;
  },
  brief: SearchBrief
): RelevanceVerdict {
  const roleName = brief.primaryTitle || 'Role';
  const designation = (candidate.currentDesignation || '').trim();

  if (locationMismatch(candidate.location, brief)) {
    return {
      tier: 'excluded',
      tierLabel: 'Removed',
      reason: `Based in ${candidate.location} - outside ${brief.locations.join('/')}`,
      keep: false,
    };
  }

  if (!designation) {
    return {
      tier: 'excluded',
      tierLabel: 'Removed',
      reason: 'No job title found in the profile',
      keep: false,
    };
  }

  const title = scoreTitle(designation, brief);

  // No overlap at all with the target role is still decisive.
  if (title.score === 0) {
    return {
      tier: 'excluded',
      tierLabel: 'Removed',
      reason: `${designation} - not ${roleName} or a recognised equivalent`,
      keep: false,
    };
  }

  const employer = scoreEmployer(candidate, brief);
  const experience = scoreExperience(candidate.yearsExperience, brief);

  if (experience.score < 0) {
    return {
      tier: 'excluded',
      tierLabel: 'Removed',
      reason: `${designation} - ${experience.note}`,
      keep: false,
    };
  }

  const domain = scoreDomain(candidate, brief);
  const totalWeight = WEIGHTS.title + WEIGHTS.employer + WEIGHTS.experience + WEIGHTS.domain;

  const total = Math.round(
    (title.score * WEIGHTS.title +
      employer.score * WEIGHTS.employer +
      experience.score * WEIGHTS.experience +
      domain * WEIGHTS.domain) /
      totalWeight
  );

  const notes = [title.note, employer.note, experience.note].filter(Boolean).join(' · ');
  const nameNote = candidate.name === 'Unknown' ? ' · name missing in source' : '';

  if (total < KEEP_THRESHOLD) {
    return {
      tier: 'excluded',
      tierLabel: 'Removed',
      reason: `${designation} - scored ${total}/100 (${notes})`,
      keep: false,
      score: total,
    };
  }

  const tier: RelevanceTier = total >= 85 ? 'core' : total >= 70 ? 'adjacent' : 'skill';
  const band = total >= 85 ? 'Core' : total >= 70 ? 'Strong' : 'Possible';

  return {
    tier,
    tierLabel: `${band} - ${roleName}`,
    reason: `${designation} · ${notes}${nameNote} (${total}/100)`,
    keep: true,
    score: total,
  };
}
