import { groqRequest, createSystemMessage } from './client';
import { SearchBrief } from '@/types/index';

export interface CandidateEvaluation {
  contextualScore: number;
  matchStrength: 'strong' | 'moderate' | 'weak';
  confirmedMatches: string[];
  uncertainRequirements: string[];
  mismatchFlags: string[];
  reasoningSummary: string;
}

export interface EvaluationInput {
  name: string;
  designation: string | null;
  organization: string | null;
  location: string | null;
  snippet: string;
  deterministicScore: number;
}

/**
 * The full SearchBrief JSON runs ~700 tokens. Sending it once per batch as a
 * short digest — rather than once per candidate — is what keeps a search
 * inside the free tier's tokens-per-minute ceiling.
 */
function compactBrief(brief: SearchBrief): string {
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push(`${label}: ${value}`);
  };

  add('Target title', brief.primaryTitle);
  add('Also acceptable', [...brief.alternativeTitles, ...brief.adjacentTitles].join(', '));
  add('Must-have skills', brief.mustHaveSkills.join(', '));
  add('Nice-to-have skills', brief.goodToHaveSkills.join(', '));
  if (brief.minExperience || brief.maxExperience) {
    add('Experience', `${brief.minExperience ?? '?'}-${brief.maxExperience ?? '?'} years`);
  }
  add('Locations', brief.locations.join(', '));
  add('Non-negotiables', brief.nonNegotiables.join('; '));
  add('Avoid', [...brief.excludedTitles, ...brief.excludeKeywords].join(', '));

  return lines.join('\n');
}

const BATCH_PROMPT = `Score each candidate against the hiring requirement.

REQUIREMENT:
{brief}

CANDIDATES:
{candidates}

Return ONLY a JSON object. Include one entry per candidate, keeping "index" as given:

{
  "evaluations": [
    {
      "index": 0,
      "contextualScore": 75,
      "matchStrength": "strong",
      "confirmedMatches": ["evidence-backed match"],
      "uncertainRequirements": ["requirement with no evidence"],
      "mismatchFlags": [],
      "reasoningSummary": "One or two sentences."
    }
  ]
}

RULES:
- Score 0-100 on available evidence only
- matchStrength: "strong", "moderate", or "weak"
- Missing information is NOT a mismatch
- Be conservative; do not invent experience the text does not show
- Return an entry for every candidate index provided
- Keep output tight: at most 3 short items per list, reasoningSummary under 20 words`;

function describe(candidate: EvaluationInput, index: number): string {
  return [
    `[${index}]`,
    `name: ${candidate.name}`,
    `title: ${candidate.designation || 'Unknown'}`,
    `company: ${candidate.organization || 'Unknown'}`,
    `location: ${candidate.location || 'Unknown'}`,
    `profile text: ${(candidate.snippet || '').slice(0, 140)}`,
  ].join(' | ');
}

function fallback(candidate: EvaluationInput): CandidateEvaluation {
  return {
    contextualScore: candidate.deterministicScore,
    matchStrength: 'moderate',
    confirmedMatches: [],
    uncertainRequirements: [],
    mismatchFlags: [],
    reasoningSummary: 'Scored on profile signals only; AI review unavailable.',
  };
}

/**
 * Evaluates a group of candidates in a single request. Returns results aligned
 * to the input order, falling back to the deterministic score for any candidate
 * the model omits.
 */
export async function evaluateCandidatesBatch(
  brief: SearchBrief,
  candidates: EvaluationInput[]
): Promise<CandidateEvaluation[]> {
  if (candidates.length === 0) return [];

  // Replacer functions, not strings. String.replace treats $&, $` and $' in
  // the REPLACEMENT as substitution patterns even when the search pattern is
  // a plain string. The candidate block is built from names, headlines and
  // Google snippets -- text this code does not control -- so one profile
  // containing $' would splice the template into itself and truncate the
  // instructions for the whole batch, silently degrading ten evaluations at
  // once. A replacer function disables the substitution.
  const prompt = BATCH_PROMPT.replace('{brief}', () => compactBrief(brief)).replace(
    '{candidates}',
    () => candidates.map(describe).join('\n')
  );

  const response = await groqRequest<{ evaluations?: Array<CandidateEvaluation & { index?: number }> }>(
    [
      {
        role: 'system' as const,
        content: createSystemMessage(
          'recruitment researcher evaluating candidate-requirement fit with emphasis on evidence-based assessment'
        ),
      },
      { role: 'user' as const, content: prompt },
    ],
    { temperature: 0.3, maxTokens: 2500, jsonMode: true }
  );

  const byIndex = new Map<number, CandidateEvaluation>();
  for (const entry of response?.evaluations ?? []) {
    if (typeof entry?.index !== 'number') continue;
    byIndex.set(entry.index, {
      contextualScore: Number(entry.contextualScore) || 0,
      matchStrength: entry.matchStrength || 'moderate',
      confirmedMatches: entry.confirmedMatches ?? [],
      uncertainRequirements: entry.uncertainRequirements ?? [],
      mismatchFlags: entry.mismatchFlags ?? [],
      reasoningSummary: entry.reasoningSummary ?? '',
    });
  }

  return candidates.map((candidate, i) => byIndex.get(i) ?? fallback(candidate));
}
