export type RepoCardGradient = {
  backgroundImage: string;
};

const MIN_LIGHTNESS = 86;
const MAX_LIGHTNESS = 94;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeName(repoName: string): string {
  return repoName.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createHsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 20, 70);
  const light = clamp(l, MIN_LIGHTNESS, MAX_LIGHTNESS);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function getStableRepoCardGradient(repoName: string): RepoCardGradient {
  const normalizedName = normalizeName(repoName);
  const hash = hashString(normalizedName || 'repo');

  const hueA = hash % 360;
  const hueB = (hueA + 35 + (hash % 75)) % 360;
  const hueC = (hueA + 220 + (hash % 60)) % 360;

  const satA = 32 + (hash % 16);
  const satB = 30 + ((hash >>> 5) % 16);
  const satC = 24 + ((hash >>> 10) % 14);

  const lightA = 90 + ((hash >>> 2) % 3);
  const lightB = 87 + ((hash >>> 6) % 4);
  const lightC = 93;

  return {
    backgroundImage: [
      `radial-gradient(circle at 15% 15%, ${createHsl(hueA, satA, lightA)} 0%, transparent 58%)`,
      `radial-gradient(circle at 85% 82%, ${createHsl(hueB, satB, lightB)} 0%, transparent 62%)`,
      `linear-gradient(145deg, ${createHsl(hueC, satC, lightC)} 0%, hsl(210 40% 98%) 100%)`,
    ].join(', '),
  };
}
