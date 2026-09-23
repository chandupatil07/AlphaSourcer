import { SearchBrief } from '@/types/index';
import { assessBrief, BriefQuality } from '@/lib/search/briefQuality';

export interface ClarifyOption {
  label: string;
  value: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  why: string;
  options: ClarifyOption[];
  allowCustom: boolean;
}

export interface ClarifyResult {
  questions: ClarifyQuestion[];
  suggestedPrompt: string;
  understood: string[];
  /**
   * Whether this brief is worth spending a search on. Previously every gap
   * below was optional and a one-line requirement ran the full pipeline.
   */
  quality: BriefQuality;
}

/**
 * Gaps that measurably hurt precision, detected from the parsed brief rather
 * than from the raw text — so a requirement that *mentions* a city but parses
 * without one is still caught.
 */
export function buildClarifications(brief: SearchBrief): ClarifyResult {
  const questions: ClarifyQuestion[] = [];

  if (!brief.primaryTitle) {
    questions.push({
      id: 'title',
      question: 'What job title should candidates currently hold?',
      why: 'Every search is anchored on the job title; without one the results cannot be filtered.',
      options: [],
      allowCustom: true,
    });
  }

  if (brief.locations.length === 0) {
    questions.push({
      id: 'location',
      question: 'Which location should candidates be in?',
      why: 'Without a location, profiles are returned worldwide.',
      options: [
        { label: 'India (anywhere)', value: 'India' },
        { label: 'Bangalore', value: 'Bangalore' },
        { label: 'Mumbai', value: 'Mumbai' },
        { label: 'Remote / no constraint', value: '' },
      ],
      allowCustom: true,
    });
  }

  if (brief.minExperience === null && brief.maxExperience === null) {
    questions.push({
      id: 'experience',
      question: 'How much experience should they have?',
      why: 'Seniority filtering is skipped without a range, so interns and directors appear together.',
      options: [
        { label: 'Under 1 year (entry level)', value: '0 to 1 years of experience' },
        { label: '1–3 years', value: '1 to 3 years of experience' },
        { label: '3–6 years', value: '3 to 6 years of experience' },
        { label: '6+ years (senior)', value: '6 or more years of experience' },
      ],
      allowCustom: true,
    });
  }

  const hasEmployerSignal =
    brief.preferredCompanies.length > 0 || brief.preferredIndustries.length > 0;

  if (!hasEmployerSignal) {
    questions.push({
      id: 'industry',
      question: 'What kind of company should they come from?',
      why: 'Naming an industry or specific employers is the single strongest filter available.',
      options: [
        { label: 'Any industry', value: '' },
        { label: 'Product / SaaS companies', value: 'candidates from product or SaaS companies' },
        { label: 'Startups', value: 'candidates from startups' },
        { label: 'Enterprise / services', value: 'candidates from enterprise or IT services companies' },
      ],
      allowCustom: true,
    });
  }

  if (brief.mustHaveSkills.length === 0 && !hasEmployerSignal) {
    questions.push({
      id: 'skills',
      question: 'Which skills or tools are non-negotiable?',
      why: 'Skills separate a genuine match from someone who merely shares a job title.',
      options: [],
      allowCustom: true,
    });
  }

  return {
    questions,
    suggestedPrompt: suggestPrompt(brief),
    understood: summarise(brief),
    quality: assessBrief(brief),
  };
}

/** What the tool believes it was asked for, in plain language. */
function summarise(brief: SearchBrief): string[] {
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  add('Title', brief.primaryTitle);
  add('Also accepting', brief.alternativeTitles.slice(0, 4).join(', '));
  add('Location', brief.locations.join(', '));

  if (brief.minExperience !== null || brief.maxExperience !== null) {
    add('Experience', `${brief.minExperience ?? 0}–${brief.maxExperience ?? 'any'} years`);
  }

  add('Target companies', brief.preferredCompanies.join(', '));
  add('Industries', brief.preferredIndustries.join(', '));
  add('Must-have skills', brief.mustHaveSkills.join(', '));

  return lines;
}

/**
 * Rewrites the brief as a well-formed requirement, so the user can see the
 * shape that searches well and reuse it.
 *
 * Every slot is always present. It used to emit only what it had, so the one
 * brief that most needed a worked example -- a vague one -- got back the two
 * words "Find candidates.", which teaches nothing and cannot be edited into
 * anything. Missing pieces now come back as angle-bracket placeholders: the
 * recruiter can see the full shape and type over the blanks.
 */
function suggestPrompt(brief: SearchBrief): string {
  const titles = [brief.primaryTitle, ...brief.alternativeTitles.slice(0, 3)]
    .filter(Boolean)
    .join(' or ');

  const parts: string[] = [
    `Find ${titles || '<job title>'} profiles`,
    brief.minExperience !== null || brief.maxExperience !== null
      ? `with ${brief.minExperience ?? 0}–${brief.maxExperience ?? 'any'} years of experience`
      : 'with <min>–<max> years of experience',
    brief.locations.length > 0
      ? `based in ${brief.locations.join(' or ')}`
      : 'based in <city or country>',
    brief.mustHaveSkills.length > 0
      ? `with hands-on ${brief.mustHaveSkills.slice(0, 5).join(', ')}`
      : 'with hands-on <skill>, <skill>',
  ];

  if (brief.preferredIndustries.length > 0) {
    parts.push(`from a ${brief.preferredIndustries.join(' or ')} background`);
  }

  let prompt = `${parts.join(', ')}.`;

  if (brief.preferredCompanies.length > 0) {
    prompt += `\n\nPrioritise candidates currently at: ${brief.preferredCompanies.join(', ')}.`;
  } else if (brief.preferredIndustries.length === 0) {
    prompt += '\n\nPrioritise candidates currently at: <company>, <company>.';
  }

  return prompt;
}
