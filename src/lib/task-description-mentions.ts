export type MentionTrigger = '@' | '$';

export type ActiveMention = {
  trigger: MentionTrigger;
  start: number;
  end: number;
  query: string;
};

function isWhitespaceCharacter(value: string): boolean {
  return /\s/.test(value);
}

export function findActiveMention(text: string, cursorPosition: number): ActiveMention | null {
  const cursor = Math.max(0, Math.min(cursorPosition, text.length));
  let start = cursor - 1;

  while (start >= 0) {
    const current = text[start];
    if (current === '@' || current === '$') {
      let end = start + 1;
      while (end < text.length && !isWhitespaceCharacter(text[end]!)) {
        end += 1;
      }

      return {
        trigger: current,
        start,
        end,
        query: text.slice(start + 1, cursor),
      };
    }

    if (isWhitespaceCharacter(current)) {
      return null;
    }

    start -= 1;
  }

  return null;
}

export function replaceActiveMention(text: string, mention: ActiveMention, suggestion: string): {
  value: string;
  cursorPosition: number;
} {
  const suffix = text.slice(mention.end);
  const needsTrailingSpace = suffix.length === 0 || !isWhitespaceCharacter(suffix[0]!);
  const insertion = `${mention.trigger}${suggestion}${needsTrailingSpace ? ' ' : ''}`;
  const value = `${text.slice(0, mention.start)}${insertion}${suffix}`;
  return {
    value,
    cursorPosition: mention.start + insertion.length,
  };
}
