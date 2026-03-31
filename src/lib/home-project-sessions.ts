import type { SessionMetadata } from '../app/actions/session.ts';
import { resolveClientActivityProjectKey } from './project-client.ts';
import type { Project } from './types.ts';

export function groupHomeProjectSessionsByProject(
  projects: Project[],
  sessions: SessionMetadata[],
): Map<string, SessionMetadata[]> {
  const sessionsByProject = new Map<string, SessionMetadata[]>();

  for (const session of sessions) {
    const projectKey = resolveClientActivityProjectKey(projects, {
      projectId: session.projectId,
      projectPath: session.projectPath,
      fallbackPath: session.repoPath,
    });
    if (!projectKey) continue;

    const existingSessions = sessionsByProject.get(projectKey);
    if (existingSessions) {
      existingSessions.push(session);
      continue;
    }
    sessionsByProject.set(projectKey, [session]);
  }

  return sessionsByProject;
}
