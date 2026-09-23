import { Candidate, SearchBrief } from '@/types/index';
import { serperSearch, normalizeLinkedInUrl } from '@/lib/serper/search';
import { SKILL_VERIFICATION } from '@/config/limits';

/**
 * Asks Google whether one named profile carries one named skill.
 *
 * Everything upstream infers skills from a search snippet -- roughly 160
 * characters of name, headline and city, which usually lists no skills at all.
 * Measured on a recorded run: 44 of 239 candidates had any skill confirmed,
 * and the shortlist evidenced Django for 6 of 137. That is a shortage of
 * evidence, not of scoring, and no amount of tuning fixes it.
 *
 *     site:in.linkedin.com/in/aman-gora "Django"
 *
 * Google matches the whole indexed page, so a hit proves the term is on that
 * profile. One query, one credit, one settled fact.
 *
 * **A miss is also evidence here, and that is the point.** Elsewhere in this
 * codebase absence is deliberately never treated as a failure, because a
 * snippet that omits a skill proves nothing. This probe is different: the page
 * is known to be indexed -- Google returned it in the first place -- and the
 * query named both the page and the term. Nothing back means the indexed page
 * does not carry the term. That is the only signal in the pipeline allowed to
 * push a skill score below neutral.
 *
 * A probe that *errors* is not a miss. Rate limits and network failures leave
 * the skill untested, exactly as if it had never been probed.
 */
export type VerifySummary = {
  probes: number;
  confirmed: number;
  absent: number;
  failed: number;
  candidatesProbed: number;
  skipped: 'disabled' | 'no-skills' | 'out-of-time' | null;
};

const EMPTY: VerifySummary = {
  probes: 0,
  confirmed: 0,
  absent: 0,
  failed: 0,
  candidatesProbed: 0,
  skipped: null,
};

/**
 * `site:` restricted to one profile. The host is taken from the candidate's
 * own URL because LinkedIn serves country subdomains (`in.linkedin.com`), and
 * a `site:linkedin.com/in/...` query does not reliably match those.
 */
function profileSiteTerm(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path.startsWith('/in/')) return null;
    return `site:${parsed.hostname}${path}`;
  } catch {
    return null;
  }
}

function exactPhrase(value: string): string {
  const clean = value.trim().replace(/"/g, '');
  return clean ? `"${clean}"` : '';
}

type Probe = {
  candidate: Candidate;
  skill: string;
  query: string;
};

/**
 * Verifies must-have skills for the strongest candidates, in place.
 *
 * `candidates` must already be ordered best-first: this is the only part of
 * the pipeline whose cost grows with the number of candidates, so it is spent
 * on the people who can still reach a recruiter.
 */
export async function verifyCandidateSkills(
  candidates: Candidate[],
  brief: SearchBrief,
  options: { elapsed: () => number }
): Promise<VerifySummary> {
  if (!SKILL_VERIFICATION.enabled) return { ...EMPTY, skipped: 'disabled' };

  const skills = brief.mustHaveSkills.map((s) => s.trim()).filter(Boolean);
  if (skills.length === 0 || candidates.length === 0) {
    return { ...EMPTY, skipped: 'no-skills' };
  }

  if (options.elapsed() >= SKILL_VERIFICATION.deadlineMs) {
    console.warn(
      `[verify] ${Math.round(options.elapsed() / 1000)}s elapsed; skipping skill verification`
    );
    return { ...EMPTY, skipped: 'out-of-time' };
  }

  // Build the probe list under both caps before spending anything.
  const probes: Probe[] = [];
  const probed = new Set<string>();

  for (const candidate of candidates.slice(0, SKILL_VERIFICATION.maxCandidates)) {
    if (probes.length >= SKILL_VERIFICATION.maxProbes) break;

    const site = profileSiteTerm(candidate.linkedinUrl);
    if (!site) continue;

    const known = new Set(
      [...(candidate.confirmedSkills ?? []), ...(candidate.absentSkills ?? [])].map((s) =>
        s.trim().toLowerCase()
      )
    );

    for (const skill of skills) {
      if (probes.length >= SKILL_VERIFICATION.maxProbes) break;
      // Already settled -- by search provenance, or by an earlier probe.
      if (known.has(skill.toLowerCase())) continue;
      probes.push({ candidate, skill, query: `${site} ${exactPhrase(skill)}` });
      probed.add(candidate.id);
    }
  }

  if (probes.length === 0) return { ...EMPTY, skipped: null };

  console.log(
    `[verify] ${probes.length} probes across ${probed.size} candidates ` +
      `(caps: ${SKILL_VERIFICATION.maxCandidates} candidates, ${SKILL_VERIFICATION.maxProbes} probes)`
  );

  let confirmed = 0;
  let absent = 0;
  let failed = 0;

  // Concurrent; the shared rate limiter in serperSearch spaces the sends, so
  // this costs credits rather than wall-clock beyond the spacing itself.
  await Promise.all(
    probes.map(async ({ candidate, skill, query }) => {
      // Re-check the clock per probe: an early one may have eaten the budget.
      if (options.elapsed() >= SKILL_VERIFICATION.deadlineMs) {
        failed += 1;
        return;
      }

      let results;
      try {
        // Deliberately no `gl`/`hl` bias here. Everywhere else the country
        // hint improves retrieval, but this query names one exact page: the
        // question is only whether the index has that term on it, and a
        // regional bias can only suppress the answer.
        results = await serperSearch(query);
      } catch {
        // Untested, not absent.
        failed += 1;
        return;
      }

      const wanted = normalizeLinkedInUrl(candidate.linkedinUrl);
      const hit = results.some((r) => normalizeLinkedInUrl(r.url) === wanted);

      if (hit) {
        candidate.confirmedSkills = [...(candidate.confirmedSkills ?? []), skill];
        confirmed += 1;
      } else {
        candidate.absentSkills = [...(candidate.absentSkills ?? []), skill];
        absent += 1;
      }

      candidate.untestedSkills = (candidate.untestedSkills ?? []).filter(
        (s) => s.trim().toLowerCase() !== skill.toLowerCase()
      );
    })
  );

  console.log(
    `[verify] ${confirmed} confirmed, ${absent} not on the profile, ${failed} could not be checked`
  );

  return {
    probes: probes.length,
    confirmed,
    absent,
    failed,
    candidatesProbed: probed.size,
    skipped: null,
  };
}
