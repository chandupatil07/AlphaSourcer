/**
 * A backend engineer whose own headline reads "Senior **Java** Backend
 * Engineer", for a brief asking for Python and Django, is not a Python
 * engineer who forgot to mention it. The headline is the one line the person
 * chose to describe themselves with, and they spent it on a different stack.
 *
 * Measured on the live run5 shortlist: **22 of 122 kept candidates** name a
 * competing stack in their headline and mention nothing of what the brief
 * asked for anywhere in their text. Two of them were in the top 20, one at
 * #10 scoring 80 and labelled "strong".
 *
 * This is the same kind of negative evidence as a verified-absent probe, but
 * free and available for every candidate rather than only the probed few. It
 * is deliberately weaker than a probe: a probe asked Google about that exact
 * page and got nothing, whereas this only observes what the person chose to
 * put in a headline.
 *
 * Two guards keep it from firing wrongly:
 *
 *  - It only applies to skills inside the requested LANGUAGE stack. A Java
 *    engineer can obviously know AWS, Kubernetes or Postgres, so nothing
 *    outside the stack is touched.
 *  - It never fires when the wanted stack appears anywhere in the profile
 *    text. "Backend Engineer (Java, Go)" whose snippet mentions Python is a
 *    polyglot, not a mismatch.
 */

/**
 * Stacks that are alternatives to one another rather than complements. Cloud,
 * datastore and infrastructure skills are deliberately absent: they combine
 * with any language and must never trigger this.
 */
export const LANGUAGE_STACKS: Record<string, string[]> = {
  python: ['python', 'django', 'flask', 'fastapi', 'pyramid'],
  java: ['java', 'spring', 'spring boot', 'springboot', 'j2ee', 'jee', 'hibernate', 'struts'],
  dotnet: ['.net', 'dotnet', 'c#', 'asp.net'],
  node: ['node', 'nodejs', 'node.js', 'express', 'expressjs', 'nestjs'],
  ruby: ['ruby', 'rails', 'ruby on rails'],
  php: ['php', 'laravel', 'symfony', 'codeigniter'],
  golang: ['golang', 'gin', 'fiber'],
  scala: ['scala', 'akka', 'play framework'],
  elixir: ['elixir', 'phoenix'],
  rust: ['rust', 'actix'],
};

function matchesWord(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#]|$)`, 'i').test(text);
}

/** The stack keys a brief's must-have skills belong to. Usually zero or one. */
export function wantedStacks(mustHaveSkills: string[]): string[] {
  const skills = mustHaveSkills.map((s) => s.trim().toLowerCase());
  return Object.entries(LANGUAGE_STACKS)
    .filter(([, terms]) => terms.some((t) => skills.includes(t)))
    .map(([key]) => key);
}

/** Whether a skill belongs to one of the stacks the brief asked for. */
export function isInWantedStack(skill: string, mustHaveSkills: string[]): boolean {
  const wanted = wantedStacks(mustHaveSkills);
  const key = skill.trim().toLowerCase();
  return wanted.some((stack) => LANGUAGE_STACKS[stack].includes(key));
}

/**
 * True when the profile's own HEADLINE advertises a language stack the brief
 * did not ask for, and the wanted stack appears nowhere in the profile text.
 *
 * The two halves read different sources on purpose, and the asymmetry is the
 * whole safeguard:
 *
 *  - The negative half reads the **headline only**. A headline is a
 *    deliberate self-description; a snippet is a truncated excerpt Google
 *    happened to choose. Firing on "Spring Boot, Kafka" glimpsed in a snippet
 *    would be reading noise as intent.
 *  - The suppressing half reads the **whole text**, headline and snippet.
 *    More evidence there can only ever cancel the penalty, never create one.
 *
 * Without that split this would smuggle back the exact inference the rest of
 * this codebase refuses: that a snippet not mentioning Python is evidence of
 * no Python. It is not. A headline spent on Java is a different claim.
 *
 * Returns false whenever the brief names no language stack at all, so a
 * non-engineering brief is never affected.
 */
export function advertisesCompetingStack(
  headline: string,
  fullText: string,
  mustHaveSkills: string[]
): boolean {
  const wanted = wantedStacks(mustHaveSkills);
  if (wanted.length === 0) return false;

  const showsWanted = wanted.some((stack) =>
    LANGUAGE_STACKS[stack].some((term) => matchesWord(fullText, term))
  );
  if (showsWanted) return false;

  return Object.entries(LANGUAGE_STACKS).some(
    ([key, terms]) => !wanted.includes(key) && terms.some((term) => matchesWord(headline, term))
  );
}
