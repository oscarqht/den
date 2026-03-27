export const SKILL_MENTION_SUGGESTION_LIMIT = 20;

export function buildSkillMentionSuggestions(
  query: string,
  installedSkills: string[],
  limit = SKILL_MENTION_SUGGESTION_LIMIT,
): string[] {
  const lowerQuery = query.toLowerCase();
  return installedSkills
    .filter((skillName) => skillName.toLowerCase().includes(lowerQuery))
    .slice(0, limit);
}
