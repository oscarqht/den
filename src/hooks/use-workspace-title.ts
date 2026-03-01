'use client';

import { useEffect } from 'react';
import { useRepository } from './use-git';
import { getRepoFolderName, getRepositoryDisplayName } from '@/lib/utils';

/**
 * Updates the document title with the repo name and page name.
 * @param repoPath - The full path to the repository (e.g., "C:\\Users\\user\\projects\\repo" or "/Users/user/projects/repo")
 * @param pageName - The name of the current page (e.g., "History", "Changes", "Stashes", "Settings")
 */
export function useWorkspaceTitle(repoPath: string | null, pageName: string) {
    const repository = useRepository(repoPath);

    useEffect(() => {
        const repoName = repoPath
            ? repository
                ? getRepositoryDisplayName(repository)
                : getRepoFolderName(repoPath)
            : 'Workspace';
        document.title = `${repoName} | ${pageName}`;
    }, [repoPath, repository, pageName]);
}
