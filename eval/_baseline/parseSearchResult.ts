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
