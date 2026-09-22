import { SearchBrief } from '@/types/index';
import { COUNTRY_GL, countryOfPlace } from '@/lib/geo/places';

/**
 * Google search parameters that bias results toward the country the brief
 * asked for.
 *
 * Until now the request carried only the query text, so every search was a
 * worldwide Google search and foreign profiles were filtered out afterwards --
 * when they could be read at all. Biasing retrieval is cheaper and stricter
 * than filtering: a profile that never enters the pool cannot survive a gate
 * that fails to recognise its city.
 *
 * `gl` is a two-letter country code and is the safe lever here. Serper also
 * accepts a `location` string, but it must match Google's own canonical
 * location names; an unrecognised value risks failing the request, so this
 * deliberately stops at `gl`.
 */
export type SerperGeo = {
  /** ISO 3166-1 alpha-2 country code. */
  gl?: string;
  /** Interface language. English keeps snippets parseable. */
  hl?: string;
};

/**
 * Derives the country bias from the brief.
 *
 * Returns an empty object -- meaning "search worldwide", the previous
 * behaviour -- when the brief names no location, when nothing in it maps to a
 * country we know, or when it spans more than one country. Narrowing a
 * multi-country brief to one of them would silently drop candidates the
 * recruiter asked for, which is worse than the breadth it would buy.
 */
export function geoFromBrief(brief: SearchBrief): SerperGeo {
  const countries = new Set<string>();

  for (const raw of [...(brief.locations ?? []), ...(brief.locationVariants ?? [])]) {
    if (!raw) continue;
    // A variant may be written as "Bangalore, India" — try the whole string
    // first, then each comma-separated part.
    const candidates = [raw, ...raw.split(',')];
    for (const part of candidates) {
      const country = countryOfPlace(part);
      if (country) {
        countries.add(country);
        break;
      }
    }
  }

  if (countries.size !== 1) return {};

  const [country] = Array.from(countries);
  const gl = COUNTRY_GL[country];
  if (!gl) return {};

  return { gl, hl: 'en' };
}

/** The request-body fragment for a geo, or nothing when there is no bias. */
export function geoParams(geo?: SerperGeo): Record<string, string> {
  if (!geo) return {};
  const params: Record<string, string> = {};
  // Guard the shape rather than trusting the caller: a malformed `gl` would
  // make Serper reject the request, losing the whole page of results.
  if (geo.gl && /^[a-z]{2}$/.test(geo.gl)) params.gl = geo.gl;
  if (geo.hl && /^[a-z]{2}$/.test(geo.hl)) params.hl = geo.hl;
  return params;
}
