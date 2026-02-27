export type RepoCardGradient = {
  backgroundImage: string;
};

type GradientFamily = {
  highlight: string;
  secondary: string;
  baseStart: string;
  baseEnd: string;
  anchorA: [number, number];
  anchorB: [number, number];
};

const GRADIENT_FAMILIES: GradientFamily[] = [
  {
    highlight: '#dce4ff',
    secondary: '#c7d2fe',
    baseStart: '#f8fafc',
    baseEnd: '#f3f6ff',
    anchorA: [12, 10],
    anchorB: [86, 84],
  },
  {
    highlight: '#dcfce7',
    secondary: '#bbf7d0',
    baseStart: '#f8fafc',
    baseEnd: '#effcf4',
    anchorA: [86, 14],
    anchorB: [14, 84],
  },
  {
    highlight: '#fae8ff',
    secondary: '#f5d0fe',
    baseStart: '#f8fafc',
    baseEnd: '#fbf2ff',
    anchorA: [50, 8],
    anchorB: [50, 90],
  },
  {
    highlight: '#ffedd5',
    secondary: '#fed7aa',
    baseStart: '#f8fafc',
    baseEnd: '#fff7ed',
    anchorA: [35, 35],
    anchorB: [84, 86],
  },
];

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

function hexToRgba(hexColor: string, alpha: number): string {
  const hex = hexColor.replace('#', '');
  const expandedHex = hex.length === 3
    ? hex.split('').map((part) => `${part}${part}`).join('')
    : hex;
  const value = Number.parseInt(expandedHex, 16);

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function clampPoint(point: [number, number]): [number, number] {
  return [
    clamp(point[0], 0, 100),
    clamp(point[1], 0, 100),
  ];
}

export function getStableRepoCardGradient(repoName: string): RepoCardGradient {
  const normalizedName = normalizeName(repoName);
  const hash = hashString(normalizedName || 'repo');
  const family = GRADIENT_FAMILIES[hash % GRADIENT_FAMILIES.length];

  const jitterA: [number, number] = [
    ((hash >>> 3) % 13) - 6,
    ((hash >>> 7) % 13) - 6,
  ];
  const jitterB: [number, number] = [
    ((hash >>> 11) % 13) - 6,
    ((hash >>> 15) % 13) - 6,
  ];
  const anchorA = clampPoint([family.anchorA[0] + jitterA[0], family.anchorA[1] + jitterA[1]]);
  const anchorB = clampPoint([family.anchorB[0] + jitterB[0], family.anchorB[1] + jitterB[1]]);

  const accentHue = hash % 360;
  const accentAlpha = 0.16 + ((hash >>> 20) % 10) / 100;

  return {
    backgroundImage: [
      `radial-gradient(circle at ${anchorA[0]}% ${anchorA[1]}%, ${hexToRgba(family.highlight, 0.82)} 0%, transparent 74%)`,
      `radial-gradient(circle at ${anchorB[0]}% ${anchorB[1]}%, ${hexToRgba(family.secondary, 0.78)} 0%, transparent 74%)`,
      `radial-gradient(circle at 50% 100%, hsla(${accentHue} 82% 86% / ${accentAlpha}) 0%, transparent 78%)`,
      `linear-gradient(145deg, ${family.baseStart} 0%, ${family.baseEnd} 100%)`,
    ].join(', '),
  };
}
