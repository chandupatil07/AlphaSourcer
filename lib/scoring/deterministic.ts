import { Candidate, SearchBrief } from '@/types/index';
import { SCORING_PROFILES } from '@/config/scoring';

export function calculateDeterministicScore(
  candidate: {
    name: string;
    currentDesignation: string | null;
    currentOrganization: string | null;
    location?: string | null;
    searchSnippet: string;
    yearsExperience?: number | null;
    confirmedSkills?: string[] | null;
  },
  brief: SearchBrief
): number {
  const profile = SCORING_PROFILES[brief.roleFamily] || SCORING_PROFILES.Generic;

  // Only dimensions the requirement actually specifies should consume weight.
  // Otherwise an unspecified dimension contributes a flat 50%, which caps the
  // achievable score well below the "excellent" band no matter how good the fit.
  let earned = 0;
  let applicableWeight = 0;

  const apply = (weight: number, score: number | null) => {
    if (score === null || weight <= 0) return;
    earned += (score / 100) * weight;
    applicableWeight += weight;
  };

  apply(
    profile.titleMatch,
    calculateTitleScore(
      candidate.currentDesignation,
      brief.primaryTitle,
      brief.alternativeTitles,
      brief.adjacentTitles,
      brief.excludedTitles
    )
  );

  apply(
    profile.mustHaveSkillMatch,
    brief.mustHaveSkills.length > 0 || brief.goodToHaveSkills.length > 0
      ? calculateSkillScore(
          candidate.currentDesignation,
          candidate.searchSnippet,
          brief.mustHaveSkills,
          brief.goodToHaveSkills,
          candidate.confirmedSkills ?? []
        )
      : null
  );

  apply(
    profile.experienceSeniority,
    calculateExperienceScore(
      candidate.currentDesignation,
      candidate.yearsExperience ?? null,
      brief.minExperience,
      brief.maxExperience
    )
  );

  apply(
    profile.location,
    brief.locations.length > 0
      ? calculateLocationScore(`${candidate.location || ''} ${candidate.searchSnippet}`, brief.locations)
      : null
  );

  apply(
    profile.companyIndustry,
    brief.preferredCompanies.length > 0 || brief.excludedCompanies.length > 0
      ? calculateCompanyScore(
          candidate.currentOrganization,
          brief.preferredCompanies,
          brief.excludedCompanies
        )
      : null
  );

  apply(
    profile.preferences,
    brief.preferredIndustries.length > 0 || brief.excludedIndustries.length > 0
      ? calculatePreferenceScore(
          candidate.searchSnippet,
          brief.preferredIndustries,
          brief.excludedIndustries
        )
      : null
  );

  apply(
    profile.otherSignals,
    brief.excludeKeywords.length > 0
      ? calculateSignalScore(candidate.searchSnippet, brief.excludeKeywords)
      : null
  );

  if (applicableWeight === 0) return 0;

  // Rescale against the weight that was actually in play.
  const score = (earned / applicableWeight) * 100;
  return Math.min(100, Math.max(0, score));
}

function calculateTitleScore(
  currentTitle: string | null,
  primaryTitle: string | null,
  alternativeTitles: string[],
  adjacentTitles: string[],
  excludedTitles: string[]
): number {
  if (!currentTitle) return 0;

  const titleLower = currentTitle.toLowerCase();

  // Check excluded titles first
  if (excludedTitles.some((t) => titleLower.includes(t.toLowerCase()))) {
    return 0;
  }

  // Exact or close match with primary title
  if (primaryTitle && titleLower.includes(primaryTitle.toLowerCase())) {
    return 100;
  }

  // Match with alternative titles
  if (alternativeTitles.some((t) => titleLower.includes(t.toLowerCase()))) {
    return 85;
  }

  // Match with adjacent titles
  if (adjacentTitles.some((t) => titleLower.includes(t.toLowerCase()))) {
    return 60;
  }

  // Partial relevance for generic terms
  const relevanceKeywords = ['engineer', 'developer', 'manager', 'lead', 'director', 'specialist'];
  if (relevanceKeywords.some((k) => titleLower.includes(k))) {
    return 30;
  }

  return 10;
}

/**
 * A Google snippet is ~160 characters of name, headline and city; it almost
 * never lists skills. Counting every unmentioned skill as a miss drove this
 * score to near zero for nearly everyone -- on the heaviest weight in the
 * Technology profile -- so ranking fell to whoever happened to have a keyword
 * in their headline.
 *
 * `confirmedSkills` carries the skills proven present by the queries that
 * returned this profile: Google matched them against the whole indexed page.
 * Skills neither confirmed nor visible in the text are untested, and are left
 * out of the denominator instead of counted as failures.
 */
function calculateSkillScore(
  currentTitle: string | null,
  snippet: string,
  mustHaveSkills: string[],
  goodToHaveSkills: string[],
  confirmedSkills: string[] = []
): number {
  const content = `${currentTitle || ''} ${snippet}`.toLowerCase();
  const confirmed = new Set(confirmedSkills.map((s) => s.toLowerCase()));

  const has = (skill: string) => {
    const s = skill.toLowerCase();
    return confirmed.has(s) || content.includes(s);
  };

  const mustTested = mustHaveSkills.filter(has);

  // Good-to-have skills are a bonus only; their absence is never evidence.
  const goodMatches = goodToHaveSkills.filter(has).length;
  const goodBonus =
    goodToHaveSkills.length > 0 ? (goodMatches / goodToHaveSkills.length) * 20 : 0;

  if (mustHaveSkills.length === 0) return Math.min(100, 50 + goodBonus);

  // Only skills we had some way of checking belong in the denominator. When
  // nothing was checkable the honest answer is neutral, not zero.
  const checkable = mustHaveSkills.filter(
    (skill) => confirmed.has(skill.toLowerCase()) || content.includes(skill.toLowerCase())
  ).length;
  if (checkable === 0) return Math.min(100, 50 + goodBonus);

  const mustPercentage = (mustTested.length / checkable) * 100;
  return Math.min(100, mustPercentage + goodBonus);
}
/**
 * Prefers the stated tenure the parser recovered. Only when no number is
 * available does it fall back to inferring seniority from title words --
 * previously the number was extracted and then never passed in at all.
 */
function calculateExperienceScore(
  currentTitle: string | null,
  yearsExperience: number | null,
  minExperience: number | null,
  maxExperience: number | null
): number {
  if (yearsExperience != null && (minExperience != null || maxExperience != null)) {
    const lo = minExperience ?? 0;
    const hi = maxExperience ?? 45;
    // Half a year of slack: profiles round their own tenure.
    if (yearsExperience >= lo - 0.5 && yearsExperience <= hi + 0.5) return 100;
    const drift = yearsExperience > hi ? yearsExperience - hi : lo - yearsExperience;
    return drift <= 1.5 ? 55 : 20;
  }

  if (!currentTitle) return 30;

  const titleLower = currentTitle.toLowerCase();

  // Senior/Lead roles
  if (titleLower.includes('senior') || titleLower.includes('lead') || titleLower.includes('principal')) {
    return maxExperience && maxExperience < 5 ? 60 : 90;
  }

  // Mid-level
  if (titleLower.includes('mid') || titleLower.includes('engineer ii') || titleLower.includes('manager')) {
    return 70;
  }

  // Junior roles
  if (titleLower.includes('junior') || titleLower.includes('associate') || titleLower.includes('analyst')) {
    return 40;
  }

  return 50;
}

function calculateLocationScore(snippet: string, locations: string[]): number {
  if (locations.length === 0) return 50;

  const snippetLower = snippet.toLowerCase();

  for (const location of locations) {
    if (snippetLower.includes(location.toLowerCase())) {
      return 100;
    }
  }

  // Partial credit when the first word of a multi-word location appears
  // ("Bengaluru" for "Bengaluru Urban"). The previous form indexed [0][0] --
  // the first CHARACTER -- so "Bangalore" tested for the letter "B", which
  // nearly every snippet contains, and handed 50 to candidates anywhere.
  const firstWord = locations[0]?.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstWord && firstWord.length > 2 && snippetLower.includes(firstWord)) {
    return 50;
  }

  return 20;
}

function calculateCompanyScore(
  currentOrganization: string | null,
  preferredCompanies: string[],
  excludedCompanies: string[]
): number {
  if (!currentOrganization) return 40;

  const orgLower = currentOrganization.toLowerCase();

  // Check excluded companies
  if (excludedCompanies.some((c) => orgLower.includes(c.toLowerCase()))) {
    return 0;
  }

  // Check preferred companies
  if (preferredCompanies.some((c) => orgLower.includes(c.toLowerCase()))) {
    return 100;
  }

  return 50;
}

function calculatePreferenceScore(
  snippet: string,
  preferredIndustries: string[],
  excludedIndustries: string[]
): number {
  const snippetLower = snippet.toLowerCase();

  // Exclusions are checked first and unconditionally. They used to sit behind
  // an early return taken whenever no PREFERRED industry was set, so a brief
  // that only said "not from X" had its one rule silently ignored.
  for (const industry of excludedIndustries) {
    if (industry.trim() && snippetLower.includes(industry.toLowerCase())) {
      return 10;
    }
  }

  if (preferredIndustries.length === 0) return 50;

  // Check preferred industries
  for (const industry of preferredIndustries) {
    if (snippetLower.includes(industry.toLowerCase())) {
      return 80;
    }
  }

  return 30;
}

function calculateSignalScore(snippet: string, excludeKeywords: string[]): number {
  if (excludeKeywords.length === 0) return 50;

  const snippetLower = snippet.toLowerCase();

  // Check for negative keywords
  for (const keyword of excludeKeywords) {
    if (snippetLower.includes(keyword.toLowerCase())) {
      return 10;
    }
  }

  return 70;
}
