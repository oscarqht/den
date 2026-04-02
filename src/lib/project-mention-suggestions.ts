export const PROJECT_MENTION_SUGGESTION_LIMIT = 20;

export type ProjectMentionSuggestionCandidate = {
  suggestion: string;
  aliases?: string[];
};

type BuildProjectMentionSuggestionsArgs = {
  query: string;
  candidates: ProjectMentionSuggestionCandidate[];
  limit?: number;
};

export function buildProjectMentionSuggestions({
  query,
  candidates,
  limit = PROJECT_MENTION_SUGGESTION_LIMIT,
}: BuildProjectMentionSuggestionsArgs): string[] {
  const lowerQuery = query.trim().toLowerCase();
  const seen = new Set<string>();

  return candidates
    .filter((candidate) => {
      const haystacks = [candidate.suggestion, ...(candidate.aliases ?? [])]
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);

      if (lowerQuery.length === 0) {
        return haystacks.length > 0;
      }

      return haystacks.some((value) => value.includes(lowerQuery));
    })
    .map((candidate) => candidate.suggestion.trim())
    .filter(Boolean)
    .filter((suggestion) => {
      if (seen.has(suggestion)) return false;
      seen.add(suggestion);
      return true;
    })
    .slice(0, limit);
}
