export interface BranchTagColors {
  backgroundColor: string;
  textColor: string;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getBranchColorSeed(branchName: string): number {
  return hashString(branchName);
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hh = h / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hh >= 0 && hh < 1) {
    r1 = c;
    g1 = x;
  } else if (hh >= 1 && hh < 2) {
    r1 = x;
    g1 = c;
  } else if (hh >= 2 && hh < 3) {
    g1 = c;
    b1 = x;
  } else if (hh >= 3 && hh < 4) {
    g1 = x;
    b1 = c;
  } else if (hh >= 4 && hh < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = light - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };

  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function getReadableTextColor(rgb: { r: number; g: number; b: number }): string {
  const backgroundLum = relativeLuminance(rgb);
  const whiteContrast = (1.05) / (backgroundLum + 0.05);
  const blackContrast = (backgroundLum + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? '#ffffff' : '#111827';
}

export function getBranchTagColors(branchName: string): BranchTagColors {
  const hash = getBranchColorSeed(branchName);

  const hue = hash % 360;
  const saturation = 72 + ((hash >>> 9) % 20); // 72-91
  const lightness = 84 + ((hash >>> 17) % 8); // 84-91

  const rgb = hslToRgb(hue, saturation, lightness);
  const textColor = getReadableTextColor(rgb);
  const backgroundColor = `hsl(${hue} ${saturation}% ${lightness}%)`;

  return {
    backgroundColor,
    textColor,
  };
}

export function getBranchGraphColor(branchName: string): string {
  const hash = getBranchColorSeed(branchName);
  const hue = hash % 360;
  return `hsl(${hue} 82% 52%)`;
}
