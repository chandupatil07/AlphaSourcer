import { SearchBrief } from '@/types/index';

/**
 * Judges whether a requirement is good enough to spend a search on.
 *
 * Until now every gap the clarifier found was optional: "Search as-is" was
 * always available, so a brief reading only "backend dev" ran the full
 * pipeline -- roughly 36 Serper credits and a minute of waiting -- and came
 * back with whoever happened to be indexed. The gaps were detected and then
 * not acted on.
 *
 * Nothing here is a guess about quality. Each rule names a concrete thing the
 * pipeline does differently when the field is missing, which is why the copy
 * can state the consequence rather than say "add more detail".
 */
export type BriefGapId = 'title' | 'location' | 'experience' | 'skills' | 'industry';

export type BriefGap = {
  id: BriefGapId;
  /** What is missing, in the recruiter's words. */
  label: string;
  /** What the pipeline actually does about it, stated plainly. */
  consequence: string;
  /**
   * `blocking` -- the search has nothing to anchor on and should not run.
   * `costly`   -- it will run, but a named constraint goes unenforced.
   */
  severity: 'blocking' | 'costly';
};

export type BriefQuality = {
  verdict: 'ready' | 'workable' | 'unusable';
  headline: string;
  detail: string;
  gaps: BriefGap[];
  /** Share of the five constraints the brief actually carries, 0-100. */
  completeness: number;
};

export function assessBrief(brief: SearchBrief): BriefQuality {
  const gaps: BriefGap[] = [];

  const hasTitle = Boolean(brief.primaryTitle?.trim());
  const hasSkills = brief.mustHaveSkills.length > 0;
  const hasLocation = brief.locations.length > 0;
  const hasExperience = brief.minExperience !== null || brief.maxExperience !== null;
  // Named by the recruiter, or derived by the model from a phrase like
  // "product startup experience". Both produce company-led queries -- run4
  // carried no named company and still ran ten of them off ten inferred
  // employers -- so treating only the named list as a signal would have told
  // the recruiter company searches were skipped while they were running.
  const namedEmployers =
    brief.preferredCompanies.length > 0 || brief.preferredIndustries.length > 0;
  const inferredEmployers = (brief.inferredCompanies ?? []).length > 0;
  const hasEmployerSignal = namedEmployers || inferredEmployers;

  // Every query is built as `site:linkedin.com/in/` plus a title, a skill or a
  // company (lib/search/buildQueries.ts). With none of the three there is
  // literally nothing to put in the query but the location, which returns
  // every indexed profile in the city.
  //
  // Model-inferred employers do anchor a query technically, and they are
  // deliberately not accepted here: they are the model's guess at what the
  // recruiter meant, and letting a guess unblock a search would mean the one
  // brief that most needs a human answer is the one that quietly proceeds
  // without it.
  const hasAnchor = hasTitle || hasSkills || brief.preferredCompanies.length > 0;

  if (!hasTitle) {
    gaps.push({
      id: 'title',
      label: 'No job title',
      consequence: hasAnchor
        ? 'Searches fall back to skills and employers alone, so people who merely mention the tool rank beside people who do the job.'
        : 'Every search is built around a job title. Without one there is nothing to search for.',
      severity: hasAnchor ? 'costly' : 'blocking',
    });
  }

  if (!hasLocation) {
    gaps.push({
      id: 'location',
      label: 'No location',
      consequence:
        'Profiles are returned worldwide and the location filter is skipped entirely, so candidates in other countries reach the shortlist.',
      severity: 'costly',
    });
  }

  if (!hasSkills && !hasEmployerSignal) {
    gaps.push({
      id: 'skills',
      label: 'No must-have skills',
      consequence:
        'Skills carry the heaviest weight in the score. With none given, everyone with the right title scores the same.',
      severity: hasAnchor ? 'costly' : 'blocking',
    });
  }

  if (!hasExperience) {
    gaps.push({
      id: 'experience',
      label: 'No experience range',
      consequence:
        'Seniority is not filtered, so interns and directors appear in the same list.',
      severity: 'costly',
    });
  }

  if (!namedEmployers) {
    gaps.push({
      id: 'industry',
      label: inferredEmployers ? 'Companies were guessed, not given' : 'No target companies or industry',
      consequence: inferredEmployers
        ? `Company searches are running against employers inferred from your wording (${brief.inferredCompanies.slice(0, 3).join(', ')}…). Naming the companies or the industry replaces a guess with your answer.`
        : 'Company-led searches are skipped, which removes the single strongest filter available.',
      severity: 'costly',
    });
  }

  // Inferred employers are a guess, so they do not count towards a brief
  // being complete -- only what the recruiter actually said does.
  const present = [hasTitle, hasLocation, hasSkills, hasExperience, namedEmployers].filter(
    Boolean
  ).length;
  const completeness = Math.round((present / 5) * 100);

  if (!hasAnchor) {
    return {
      verdict: 'unusable',
      headline: 'This cannot be searched yet',
      detail:
        'A search needs at least a job title, a required skill or a target company to look for. Add one below, or use the suggested wording.',
      gaps,
      completeness,
    };
  }

  if (gaps.length === 0) {
    return {
      verdict: 'ready',
      headline: 'Ready to search',
      detail: 'Title, location, experience, skills and company background are all set.',
      gaps,
      completeness,
    };
  }

  return {
    verdict: 'workable',
    headline: `This will run, but ${gaps.length} constraint${gaps.length === 1 ? '' : 's'} will not be enforced`,
    detail:
      'Filling these in costs nothing and is the difference between a shortlist and a list. Every one is optional.',
    gaps,
    completeness,
  };
}
