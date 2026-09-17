import { Candidate, SearchBrief } from '@/types/index';
import { SCORING_PROFILES } from '@/config/scoring';

export function calculateDeterministicScore(
  candidate: {
    name: string;
    currentDesignation: string | null;
    currentOrganization: string | null;
    location?: string | null;
    searchSnippet: string;
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
          brief.goodToHaveSkills
        )
      : null
  );

  apply(
    profile.experienceSeniority,
    calculateExperienceScore(candidate.currentDesignation, brief.minExperience, brief.maxExperience)
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

function calculateSkillScore(
  currentTitle: string | null,
  snippet: string,
  mustHaveSkills: string[],
  goodToHaveSkills: string[]
): number {
  const content = `${currentTitle || ''} ${snippet}`.toLowerCase();

  let matchCount = 0;
  let totalRequired = mustHaveSkills.length;

  for (const skill of mustHaveSkills) {
    if (content.includes(skill.toLowerCase())) {
      matchCount++;
    }
  }

  if (totalRequired === 0) return 50;

  const mustHavePercentage = (matchCount / totalRequired) * 100;

  // Bonus for good-to-have skills
  let goodToHaveMatches = 0;
  for (const skill of goodToHaveSkills) {
    if (content.includes(skill.toLowerCase())) {
      goodToHaveMatches++;
    }
  }

  const goodToHaveBonus = goodToHaveSkills.length > 0 ? (goodToHaveMatches / goodToHaveSkills.length) * 20 : 0;

  return Math.min(100, mustHavePercentage + goodToHaveBonus);
}

function calculateExperienceScore(
  currentTitle: string | null,
  minExperience: number | null,
  maxExperience: number | null
): number {
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

  // Partial credit if location is mentioned but not exact match
  if (locations[0] && snippet.includes(locations[0][0])) {
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
  if (preferredIndustries.length === 0) return 50;

  const snippetLower = snippet.toLowerCase();

  // Check excluded industries
  for (const industry of excludedIndustries) {
    if (snippetLower.includes(industry.toLowerCase())) {
      return 10;
    }
  }

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
