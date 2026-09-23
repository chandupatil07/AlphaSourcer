import { groqRequest, createSystemMessage } from './client';
import { SearchBrief } from '@/types/index';
import { normalizeBrief } from '@/lib/search/normalizeBrief';

const PARSE_REQUIREMENT_PROMPT = `Analyze the hiring requirement and extract a structured search brief.

REQUIREMENT:
{requirement}

Return ONLY a valid JSON object (no markdown, no extra text) with this exact structure. Use null for missing values, empty arrays for empty lists:

{
  "primaryTitle": "primary job title or null",
  "alternativeTitles": [],
  "adjacentTitles": [],
  "roleFamily": "Technology",
  "mustHaveSkills": [],
  "goodToHaveSkills": [],
  "skillSynonyms": {},
  "minExperience": null,
  "maxExperience": null,
  "locations": [],
  "locationVariants": [],
  "preferredCompanies": [],
  "inferredCompanies": [],
  "educationQualifications": [],
  "studentStatus": null,
  "inferredInstitutions": [],
  "excludedCompanies": [],
  "preferredIndustries": [],
  "excludedIndustries": [],
  "excludedTitles": [],
  "excludeKeywords": [],
  "nonNegotiables": [],
  "candidateSummary": "brief description",
  "searchStrategySummary": "sourcing approach summary"
}

RULES:
- educationQualifications: degrees or qualifications named in the requirement
  (BBA, BMS, MBA, PGDM, B.Tech, MSW...). Empty if none are mentioned.
- studentStatus: "pursuing" when the requirement asks for current students or
  people still studying ("pursuing", "final year", "undergraduate"); "graduate"
  when it asks for people who have completed a degree; otherwise null.
- inferredInstitutions: when studentStatus is "pursuing" AND a region is given,
  name 8-12 real, well-regarded colleges in that region offering those degrees
  (for BBA/BMS/MBA in Maharashtra: Jamnalal Bajaj, SIBM Pune, NMIMS, Symbiosis,
  Welingkar, K J Somaiya...). Empty otherwise. Real institutions only.
- inferredCompanies: leave EMPTY when studentStatus is "pursuing" — students are
  found through their college, not through employers.
- inferredCompanies: name 8-12 real, currently-operating companies whose core
  business is THE WORK THIS ROLE DOES, respecting any stated location. Derive
  them from the ROLE, not from the sector the named companies happen to sit in:
  for a Background Verification role, that means background-screening firms
  (AuthBridge, IDfy, HireRight, First Advantage, OnGrid, SpringVerify), NOT
  general HR software vendors like Darwinbox or Keka, which do not do that work.
  Include these even when the requirement already names companies, since
  phrasing like "or any such companies" invites more, but never repeat one
  already listed in preferredCompanies. Before listing a company, check it
  actually performs this role's function. Leave EMPTY when no industry, domain
  or employer context is stated, and when studentStatus is "pursuing".
- alternativeTitles: ALWAYS provide 3-6 real-world titles used for the SAME job
  (e.g. for "Ontologist": Knowledge Engineer, Taxonomist, Semantic Engineer,
  Knowledge Graph Engineer, Ontology Engineer). Never leave this empty.
- adjacentTitles: ALWAYS provide 2-4 neighbouring roles people move in from.
  Never leave this empty.
- These two are inferred from domain knowledge, not copied from the text.
- Everything else: extract ONLY information explicitly stated
- Use null for missing values (not empty strings)
- Keep arrays empty if no items found
- Location normalized (e.g., "Bangalore" not "Blr")
- roleFamily: must be one of: Technology, Sales, Recruitment, Finance, Operations, Marketing, Product, Design, Customer Success, Generic`;

export async function parseRequirement(requirement: string): Promise<SearchBrief> {
  // Replaced via a function, not a string. String.replace treats $&, $` and
  // $' in the REPLACEMENT as substitution patterns even when the search
  // pattern is a plain string, so a requirement containing $' would splice
  // part of the template back into itself and drop the rules that follow.
  // A replacer function disables that entirely.
  const prompt = PARSE_REQUIREMENT_PROMPT.replace('{requirement}', () => requirement);

  const messages = [
    {
      role: 'system' as const,
      content: createSystemMessage('recruitment researcher and Boolean search specialist'),
    },
    {
      role: 'user' as const,
      content: prompt,
    },
  ];

  const result = await groqRequest<unknown>(messages, {
    temperature: 0.3,
    maxTokens: 1600,
    jsonMode: true,
  });

  // Never hand an unvalidated model response to the rest of the pipeline.
  return normalizeBrief(result);
}
