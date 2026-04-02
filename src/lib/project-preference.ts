import type { Project } from './types.ts';

type ProjectPreferenceFields = Pick<Project, 'id' | 'iconPath' | 'iconEmoji' | 'lastOpenedAt'>;

function parseProjectLastOpenedAt(project: Pick<Project, 'lastOpenedAt'>): number {
  const rawValue = project.lastOpenedAt?.trim();
  if (!rawValue) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsedValue = Date.parse(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : Number.NEGATIVE_INFINITY;
}

function hasProjectIcon(project: Pick<Project, 'iconPath' | 'iconEmoji'>): boolean {
  return Boolean(project.iconEmoji?.trim() || project.iconPath?.trim());
}

export function compareProjectPreference(
  left: ProjectPreferenceFields,
  right: ProjectPreferenceFields,
): number {
  const timestampDifference = parseProjectLastOpenedAt(right) - parseProjectLastOpenedAt(left);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  const leftHasIcon = hasProjectIcon(left);
  const rightHasIcon = hasProjectIcon(right);
  if (leftHasIcon !== rightHasIcon) {
    return leftHasIcon ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
}

export function pickPreferredProject<T extends ProjectPreferenceFields>(projects: T[]): T | null {
  let preferredProject: T | null = null;

  for (const project of projects) {
    if (!preferredProject || compareProjectPreference(project, preferredProject) < 0) {
      preferredProject = project;
    }
  }

  return preferredProject;
}
