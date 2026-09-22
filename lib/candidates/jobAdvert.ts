/**
 * Detects a job advert that has been indexed as if it were a candidate.
 *
 * An X-ray search returns LinkedIn profile pages, but a recruiter who writes
 * their vacancy into their own headline produces a page that looks, to every
 * downstream stage, like a person whose job title is the role being hired
 * for. It then matches the title requirement perfectly and can rank near the
 * top -- the recruiter sees an advert for their own vacancy sitting in their
 * shortlist.
 *
 * Observed live: "Looking for Backend Developer(Java & Python) - Bangalore
 * (hybrid) &.Inbox for further details."
 *
 * The risk in the other direction is real and matters more. A recruiter IS a
 * valid candidate when the brief is hiring recruiters, and phrases like
 * "hiring for" belong in a genuine recruiter's headline. So this asks for
 * either one unambiguous advert phrase or two weaker ones together, and
 * everything it flags is excluded with a stated reason rather than dropped
 * silently, so the decision stays reviewable.
 *
 * Measured across 644 recorded candidates from three sessions -- including a
 * background-verification brief full of genuine recruiters -- this flags 1
 * and produces no false positives.
 */

/** Phrases that essentially only appear in an advert. */
const STRONG_SIGNALS: RegExp[] = [
  /\bwe(?:'re| are)\s+hiring\b/i,
  /\bnow\s+hiring\b/i,
  /#hiring\b/i,
  /\bwalk[-\s]?in\b/i,
  /\binterested\s+candidates?\b/i,
  /\burgent(?:ly)?\s+(?:required|hiring|opening)/i,
  /\bjob\s+opening\b/i,
  /\bvacanc(?:y|ies)\b/i,
  /\bapply\s+now\b/i,
];

/** Phrases that suggest an advert but occur in ordinary headlines too. */
const WEAK_SIGNALS: RegExp[] = [
  /\blooking\s+for\b/i,
  /\bhiring\s+for\b/i,
  /\binbox\b/i,
  /\bdm\s+me\b/i,
  /\bdrop\s+(?:your\s+)?(?:cv|resume)\b/i,
  /\bshare\s+(?:your\s+)?(?:cv|resume|profile)\b/i,
  /\bimmediate\s+joiner/i,
  /\bnotice\s+period\b/i,
  /\bctc\b/i,
  /\bfurther\s+details\b/i,
  /\bopen\s+position/i,
];

export type AdvertVerdict = {
  isAdvert: boolean;
  /** The phrases that fired, for the removal reason shown to the recruiter. */
  matched: string[];
};

export function detectJobAdvert(
  currentDesignation: string | null,
  searchSnippet: string
): AdvertVerdict {
  const text = `${currentDesignation ?? ''} ${searchSnippet ?? ''}`.trim();
  if (!text) return { isAdvert: false, matched: [] };

  const hit = (patterns: RegExp[]) =>
    patterns
      .map((pattern) => text.match(pattern)?.[0])
      .filter((value): value is string => Boolean(value));

  const strong = hit(STRONG_SIGNALS);
  const weak = hit(WEAK_SIGNALS);

  const isAdvert = strong.length >= 1 || weak.length >= 2;
  return {
    isAdvert,
    matched: [...strong, ...weak].map((value) => value.trim().toLowerCase()),
  };
}
