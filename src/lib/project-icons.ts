export const DEFAULT_PROJECT_ICON_PATH = '/default_project_icon.png';

export type ProjectIconValue = {
  iconPath?: string | null;
  iconEmoji?: string | null;
};

const EMOJI_FONT_FAMILY = [
  'Apple Color Emoji',
  'Segoe UI Emoji',
  'Noto Color Emoji',
  'Twemoji Mozilla',
  'Android Emoji',
  'EmojiSymbols',
  'sans-serif',
].join(', ');

function buildEmojiIconDataUrl(iconEmoji: string): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">',
    `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="96" font-family="${EMOJI_FONT_FAMILY}">`,
    iconEmoji,
    '</text>',
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function hasProjectIcon(icon?: ProjectIconValue | null): boolean {
  if (!icon) return false;
  return Boolean(icon.iconEmoji?.trim() || icon.iconPath?.trim());
}

export function getProjectIconUrl(icon?: ProjectIconValue | null): string {
  const iconEmoji = icon?.iconEmoji?.trim();
  if (iconEmoji) {
    return buildEmojiIconDataUrl(iconEmoji);
  }

  const iconPath = icon?.iconPath?.trim();
  if (iconPath) {
    return `/api/file-thumbnail?path=${encodeURIComponent(iconPath)}`;
  }

  return DEFAULT_PROJECT_ICON_PATH;
}
