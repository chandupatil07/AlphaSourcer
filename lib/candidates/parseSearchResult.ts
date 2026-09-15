import { SearchResult } from '@/types/index';

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

// Countries and cities used to anchor a location inside snippet prose.
const LOCATION_COUNTRIES = new Set([
  'india', 'united states', 'usa', 'united kingdom', 'uk', 'canada', 'australia',
  'singapore', 'germany', 'france', 'netherlands', 'ireland', 'japan', 'china',
  'united arab emirates', 'uae',
]);

const LOCATION_CITIES = new Set([
  'bengaluru', 'bangalore', 'mumbai', 'bombay', 'delhi', 'new delhi', 'noida',
  'gurgaon', 'gurugram', 'hyderabad', 'chennai', 'pune', 'kolkata', 'ahmedabad',
  'jaipur', 'kochi', 'indore', 'coimbatore', 'chandigarh', 'nagpur', 'bhubaneswar',
  'thiruvananthapuram', 'mysuru', 'mysore', 'vadodara', 'surat', 'lucknow',
  'london', 'singapore', 'dubai', 'san francisco', 'seattle', 'new york',
  'toronto', 'berlin', 'sydney',
]);

const trimTail = (value: string) => value.replace(/[.\s]+$/, '').trim();

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

  // "... Location: Bengaluru ..."
  const labelled = text.match(/Location:\s*([^·•|]+)/i);
  if (labelled) {
    const value = trimTail(clean(labelled[1]));
    if (value && value.length <= 60) return value;
  }

  // Comma runs anchored on a country or a city. Google truncates snippets
  // ("Bengaluru, Karnataka, Ind..."), so a city anchor is needed too.
  for (const part of text.split(/[·•|]/)) {
    const segments = part.split(',').map((seg) => trimTail(clean(seg))).filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].toLowerCase();
      const isCountry = LOCATION_COUNTRIES.has(seg);
      if (!isCountry && !LOCATION_CITIES.has(seg)) continue;
      const from = isCountry ? Math.max(0, i - 2) : i;
      const value = segments.slice(from, i + 1).join(', ');
      if (value.length <= 60) return value;
    }
  }

  // Last resort: a bare city mid-sentence ("... based in Bengaluru.").
  for (const city of LOCATION_CITIES) {
    if (new RegExp(`(^|[\\s(])${city}([\\s.,)]|$)`, 'i').test(text)) {
      return city.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  return null;
}

/**
 * Google renders some LinkedIn results as "Experience: Acme · Education: X ·
 * Location: Y", and others mention the employer only in prose. Reading those
 * recovers an employer for roughly half the results that carry no subtitle.
 */
function employerFromSnippet(snippet: string): string | null {
  const text = clean(snippet);
  if (!text) return null;

  const labelled = text.match(/Experience:\s*([^·•|]+)/i);
  if (labelled) {
    const value = clean(labelled[1]).replace(/\s+\d+\s+years?.*$/i, '');
    if (value && value.length < 60) return value;
  }

  // "… · 2 years 2 months · Background Verification Specialist" style entries
  // put the company immediately before a tenure run.
  const beforeTenure = text.match(/([A-Z][\w&.,'\-]*(?:\s+[A-Z][\w&.,'\-]*){0,3})\.?\s+\d+\s+years?\s+\d*\s*months?/);
  if (beforeTenure) {
    const value = clean(beforeTenure[1]);
    if (value && value.length < 60) return value;
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
  const title = clean(result.title);
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
