import type { HomeProjectGitRepo } from './home-project-git';

export function shouldShowHomeProjectGitAction(
  projectGitRepos: HomeProjectGitRepo[] | undefined,
): boolean {
  return Array.isArray(projectGitRepos) && projectGitRepos.length > 0;
}
