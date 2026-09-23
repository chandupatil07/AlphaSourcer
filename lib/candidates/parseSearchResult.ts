import { SearchResult } from '@/types/index';
import { CITY_NAMES, COUNTRY_NAMES, INDIAN_REGIONS, countryOfPlace } from '@/lib/geo/places';

export interface ParsedCandidate {
  name: string;
  currentDesignation: string | null;
  currentOrganization: string | null;
  location: string | null;
  /** Years of experience where the profile text states it; null when unknown. */
  yearsExperience: number | null;
  extractionConfidence: number;
}

// Google renders LinkedIn subtitles as "Location · Title · Company".
const SUBTITLE_SEPARATOR = /\s*[·•]\s*/;

// A LinkedIn result title reads "Name - Headline".
const NAME_SEPARATOR = ' - ';

/**
 * Google appends its own page-title suffix to every LinkedIn result:
 * "Name - Headline - LinkedIn". Left in place it becomes part of the job
 * title, so 95 of 644 recorded candidates carried designations like
 * "Senior Backend Engineer - LinkedIn" -- shown to the recruiter, written
 * into the Excel export, and tokenised into the title score, where the extra
 * term dilutes the match against the requested title.
 *
 * Only a TRAILING suffix is removed, and only after a separator, so an
 * employer named in the headline ("Backend Engineer at LinkedIn") survives.
 * Truncated forms appear too, because Google clips long titles.
 */
const LINKEDIN_SUFFIX = /\s*[-|\u2013\u2014]\s*Linked\s?In?\s*$/i;

function clean(value: string | undefined | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function cleanName(raw: string): string {
  const name = clean(raw)
    .replace(/\s*\([^)]*\)/g, '') // drop "(Aspiring Analyst)" style asides
    .replace(/[.,|]+$/, '')
    .trim();

  // Headlines leaking into the name slot are not usable identities.
  if (!name || name.length > 60 || /[|]/.test(name)) return '';
  return name;
}

function looksLikeLocation(value: string): boolean {
  return /,/.test(value) || /(area|region|district|greater)/i.test(value);
}

// Place names come from the shared dataset in lib/geo/places, so the parser
// and the relevance gate agree on what counts as a city. They used to be two
// separate hand-maintained lists, and a city in one but not the other produced
// a profile whose location could be read but not matched, or the reverse.
const LOCATION_COUNTRIES = new Set(COUNTRY_NAMES);
const LOCATION_CITIES = new Set(CITY_NAMES);
const LOCATION_REGIONS = new Set(INDIAN_REGIONS);

/**
 * City names that are also ordinary English words or famous universities.
 * They stay available inside a comma run, where "Reading, England" is
 * unambiguous, but are kept out of the bare mid-sentence scan, where
 * "reading logs" or "Cambridge" in a degree line would otherwise be read as
 * the candidate's home city.
 */
const AMBIGUOUS_BARE_CITIES = new Set([
  'reading', 'cambridge', 'oxford', 'phoenix', 'columbus', 'salem', 'richmond',
  'durham', 'charleston', 'huntington', 'manhattan', 'waterloo', 'kota',
  'mobile', 'goa', 'berkeley', 'irving', 'arlington', 'washington dc',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One precompiled alternation for the bare-city scan.
 *
 * Building a RegExp per city per snippet would be several hundred
 * constructions for every candidate; across a few hundred candidates a search
 * that should be network-bound starts spending real time compiling regexes.
 * Longest names first, so "new delhi" wins over "delhi" and "san jose" over
 * a shorter prefix.
 */
const BARE_CITY_PATTERN = new RegExp(
  '(^|[\\s(,])(' +
    CITY_NAMES.filter((city) => !AMBIGUOUS_BARE_CITIES.has(city))
      .slice()
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|') +
    ')([\\s.,)]|$)',
  'i'
);

const trimTail = (value: string) => value.replace(/[.\s]+$/, '').trim();

const titleCase = (value: string) => value.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Recovers a location from snippet prose.
 *
 * Location used to be read only from `result.subtitle`. Serper stopped
 * returning that field, so extraction silently fell to zero -- on a live run,
 * 99 of 235 snippets said "Bengaluru, Karnataka, India" in plain text while not
 * one candidate carried a location. With nothing to compare, the relevance
 * gate treated every profile as location-unknown and let it through, so a
 * "Bangalore only" brief was not enforced at all.
 */
function locationFromSnippet(snippet: string): string | null {
  const text = clean(snippet);
  if (!text) return null;

  // "... Location: Bengaluru ..." — an explicit label beats any inference.
  const labelled = text.match(/Location:\s*([^·•|]+)/i);
  if (labelled) {
    const value = trimTail(clean(labelled[1]));
    if (value && value.length <= 60) return value;
  }

  // An "Education:" run names the institution's city, not the candidate's.
  // "Education: Indian Institute of Technology, Roorkee" would otherwise put
  // a Bangalore engineer in Roorkee. Drop it before looking for a place.
  const body = text.replace(/Education:\s*[^·•|]*/gi, ' ');

  // Comma runs anchored on a country, a state or a city. Google truncates
  // snippets ("Bengaluru, Karnataka, Ind..."), so a city anchor is needed too.
  for (const part of body.split(/[·•|]/)) {
    const segments = part.split(',').map((seg) => trimTail(clean(seg))).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].toLowerCase();
      const isCountry = LOCATION_COUNTRIES.has(seg);
      const isRegion = LOCATION_REGIONS.has(seg);
      if (!isCountry && !isRegion && !LOCATION_CITIES.has(seg)) continue;

      // Reach back far enough to carry the city with its anchor:
      // "Bengaluru, Karnataka, India" anchors on the country two segments on.
      const from = isCountry ? Math.max(0, i - 2) : isRegion ? Math.max(0, i - 1) : i;
      const value = segments.slice(from, i + 1).join(', ');
      if (value.length <= 60) return value;
    }
  }

  // Last resort: a bare city mid-sentence ("... based in Bengaluru.").
  const bare = body.match(BARE_CITY_PATTERN);
  if (bare) return titleCase(bare[2].toLowerCase());

  return null;
}

/**
 * Recovers the current employer from the result text.
 *
 * Employer carries 30% of the relevance weight, and on a recorded live
 * session only 12% of candidates had one -- so most of that weight was being
 * decided by an absence. LinkedIn headlines almost always name the employer;
 * they just rarely use the one shape the parser knew.
 *
 * Two mistakes are specifically avoided:
 *   - "Ex-Amazon", "formerly at X" name a PAST employer. Reading them as
 *     current would place the candidate at a company they have left.
 *   - "based at Bangalore" is a place, not a company. Anything that resolves
 *     to a known city or country is rejected.
 */

/** Words that mean the following name is not where the candidate works now. */
const NOT_CURRENT_EMPLOYER = /^(?:ex|former|formerly|previously|prev|the|a|an|my|our|we)\b/i;

/**
 * Page furniture and bare technology names, neither of which is an employer.
 *
 * "Senior Backend Engineer, Python" alongside "at GCP" yielded the employer
 * "GCP" -- a platform, not a company. These are rejected only as a WHOLE
 * value, so "Amazon AWS" and "Microsoft Azure" still resolve correctly.
 */
const NOT_A_COMPANY = new Set([
  'linkedin', 'linkedln', 'india', 'experience', 'education', 'location',
  'present', 'company', 'university', 'college', 'institute', 'school',
  'gcp', 'aws', 'azure', 'kubernetes', 'docker', 'react', 'angular', 'vue',
  'node', 'nodejs', 'java', 'python', 'golang', 'sql', 'mysql', 'postgres',
  'postgresql', 'mongodb', 'redis', 'kafka', 'linux', 'git', 'django',
  'spring', 'springboot', 'flask', 'typescript', 'javascript',
]);

function cleanEmployer(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = clean(raw)
    // Stop at the first separator: a headline continues past the employer.
    .split(/[|·•]/)[0]
    // Google's own section labels can be swept into the capture, turning
    // "Experience InMobi 5 years" into the employer "Experience InMobi".
    .replace(/^(?:experience|education|location|about|skills)\s+/i, '')
    .replace(/[,.;:\-\s]+$/, '')
    .trim();

  if (!value || value.length > 60) return null;
  if (NOT_CURRENT_EMPLOYER.test(value)) return null;
  if (NOT_A_COMPANY.has(value.toLowerCase())) return null;
  // "at Bangalore" is a place, not an employer.
  if (countryOfPlace(value)) return null;

  return value;
}

function employerFromSnippet(snippet: string): string | null {
  const text = clean(snippet);
  if (!text) return null;

  // "Experience: Acme · Education: ..." — Google's own structured rendering.
  const labelled = text.match(/Experience:\s*([^·•|]+)/i);
  if (labelled) {
    const value = cleanEmployer(clean(labelled[1]).replace(/\s+\d+\s+years?.*$/i, ''));
    if (value) return value;
  }

  // "Senior Backend Engineer @ Amazon AWS" and "@Freshworks". The lookbehind
  // keeps "Ex-@Flipkart" style past employers out.
  const atSign = text.match(/(?<!ex[\s-])@\s*([A-Za-z][\w&.'\-]*(?:\s+[A-Z][\w&.'\-]*){0,3})/);
  if (atSign) {
    const value = cleanEmployer(atSign[1]);
    if (value) return value;
  }

  // "Backend Developer at Swiggy", "Senior Backend Engineer at Uber".
  // A role word before "at" keeps ordinary prose ("working at scale") out,
  // and the capitalised capture keeps places and verbs out.
  const roleAt = text.match(
    /\b(?:engineer|developer|manager|analyst|specialist|executive|lead|architect|consultant|designer|scientist|associate|officer|intern)\s+at\s+([A-Z][\w&.'\-]*(?:\s+[A-Z][\w&.'\-]*){0,3})/i
  );
  if (roleAt) {
    const value = cleanEmployer(roleAt[1]);
    if (value) return value;
  }

  // "… · 2 years 2 months · Background Verification Specialist" style entries
  // put the company immediately before a tenure run.
  const beforeTenure = text.match(/([A-Z][\w&.,'\-]*(?:\s+[A-Z][\w&.,'\-]*){0,3})\.?\s+\d+\s+years?\s+\d*\s*months?/);
  if (beforeTenure) {
    const value = cleanEmployer(beforeTenure[1]);
    if (value) return value;
  }

  return null;
}

/**
 * Reads a stated tenure: "5+ Years", "2 years 2 months", "1.5 years".
 * Ordering matters — a naive whole-number match reads "2.6 years" as 6.
 */
function yearsFromSnippet(text: string): number | null {
  const source = clean(text);
  if (!source) return null;

  // "2 years 2 months"
  const combined = source.match(/(?<![\d.])(\d{1,2})\s*(?:years?|yrs?)\s+(\d{1,2})\s*(?:months?|mos?)\b/i);
  if (combined) {
    const years = Number(combined[1]) + Number(combined[2]) / 12;
    if (years > 0 && years <= 45) return Number(years.toFixed(2));
  }

  // "1.5 years" — must be tried before the whole-number form, which would
  // otherwise read "2.6 years" as six.
  const decimal = source.match(/(?<![\d.])(\d{1,2}\.\d+)\s*\+?\s*(?:years?|yrs?)\b/i);
  if (decimal) {
    const years = Number(decimal[1]);
    if (years > 0 && years <= 45) return years;
  }

  // "5+ years", "6 Years Experience"
  const whole = source.match(/(?<![\d.])(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i);
  if (whole) {
    const years = Number(whole[1]);
    if (years > 0 && years <= 45) return years;
  }

  // "8 months"
  const months = source.match(/(?<![\d.])(\d{1,2})\s*(?:months?|mos?)\b/i);
  if (months) {
    const value = Number(months[1]);
    if (value > 0 && value <= 24) return Number((value / 12).toFixed(2));
  }

  return null;
}

/**
 * Pulls candidate fields out of a search result without calling an LLM.
 * Serper already returns this data structurally, so parsing it here keeps the
 * pipeline off the Groq token budget and out of rate-limit territory.
 */
export function parseSearchResult(result: SearchResult): ParsedCandidate {
  const title = clean(result.title).replace(LINKEDIN_SUFFIX, '').trim();
  const subtitle = clean(result.subtitle);

  const titleParts = title.split(NAME_SEPARATOR);
  const name = cleanName(titleParts[0] || '');
  const headline = clean(titleParts.slice(1).join(NAME_SEPARATOR));

  let currentDesignation: string | null = null;
  let currentOrganization: string | null = null;
  let location: string | null = null;
  let confidence = 0;

  if (subtitle) {
    const parts = subtitle.split(SUBTITLE_SEPARATOR).map(clean).filter(Boolean);

    if (parts.length >= 3) {
      location = parts[0];
      currentDesignation = parts[1];
      currentOrganization = parts.slice(2).join(' ');
      confidence = 90;
    } else if (parts.length === 2) {
      if (looksLikeLocation(parts[0])) {
        location = parts[0];
        currentDesignation = parts[1];
      } else {
        currentDesignation = parts[0];
        currentOrganization = parts[1];
      }
      confidence = 70;
    }
  }

  // No subtitle: fall back to the headline half of the result title.
  if (!currentDesignation && headline) {
    const firstSegment = clean(headline.split(/[|•·]/)[0]);
    const atMatch = firstSegment.match(/^(.*?)\s+at\s+(.+)$/i);

    if (atMatch) {
      currentDesignation = clean(atMatch[1]) || null;
      currentOrganization = clean(atMatch[2]) || null;
      confidence = 60;
    } else {
      currentDesignation = firstSegment || null;
      confidence = 50;
    }
  }

  if (!name) confidence = Math.min(confidence, 20);

  // Fall back to the prose when the structured subtitle carried no employer.
  if (!currentOrganization) {
    currentOrganization = employerFromSnippet(result.snippet);
  }

  // Same for location, which the subtitle no longer supplies at all.
  if (!location) {
    location = locationFromSnippet(`${title} ${result.snippet}`);
  }

  const yearsExperience = yearsFromSnippet(`${title} ${result.snippet}`);

  return {
    name: name || 'Unknown',
    currentDesignation: currentDesignation || null,
    currentOrganization: currentOrganization || null,
    location,
    yearsExperience,
    extractionConfidence: name ? confidence : Math.min(confidence, 20),
  };
}
