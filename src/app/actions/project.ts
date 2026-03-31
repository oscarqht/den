'use server';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import { resolveRepositoryPathByName } from '../../lib/repo-resolver.ts';
import { addProject, findProjectByFolderPath, getProjectById, getProjects } from '../../lib/store.ts';
import { buildProjectFolderEntries, getProjectPrimaryFolderPath, normalizeProjectFolderPath } from '../../lib/project-folders.ts';
import { getAllCredentials, getCredentialById, getCredentialToken } from '../../lib/credentials.ts';
import type { Credential } from '../../lib/credentials.ts';
import { detectGitRemoteProvider, parseGitRemoteHost } from '../../lib/terminal-session.ts';
import { listDrafts, type DraftMetadata } from './draft.ts';
import { listSessions, type SessionMetadata } from './session.ts';

type GitBranch = {
  name: string;
  current: boolean;
};

export type ResolveProjectResult = {
  success: boolean;
  projectId: string | null;
  projectPath: string | null;
  error?: string;
};

export type CloneRemoteProjectResult = {
  success: boolean;
  projectId: string | null;
  projectPath: string | null;
  error?: string;
};

export type DiscoveredProjectGitRepo = {
  repoPath: string;
  relativePath: string;
};

export type DiscoverProjectGitReposResult = {
  repos: DiscoveredProjectGitRepo[];
  truncated: boolean;
  scannedDirs: number;
  overlapDetected: boolean;
};

export type DiscoverProjectGitReposWithBranchesResult = DiscoverProjectGitReposResult & {
  branchesByRepo: Record<string, GitBranch[]>;
};

export type ProjectActivityResult = {
  sessions: SessionMetadata[];
  drafts: DraftMetadata[];
};

const DISCOVERY_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.viba',
  '.cache',
  'dist',
  'build',
  'coverage',
]);

const MAX_DISCOVERY_DEPTH = 8;
const MAX_DISCOVERED_DIRS = 15000;
const MAX_DISCOVERED_REPOS = 200;

function normalizeAbsolutePath(targetPath: string): string {
  return path.resolve(targetPath);
}

function pathContainsPath(parentPath: string, candidatePath: string): boolean {
  const normalizedParent = normalizeAbsolutePath(parentPath);
  const normalizedCandidate = normalizeAbsolutePath(candidatePath);
  if (normalizedParent === normalizedCandidate) return true;

  const relativePath = path.relative(normalizedParent, normalizedCandidate);
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function hasOverlappingRepoRoots(repoPaths: string[]): boolean {
  const normalized = Array.from(
    new Set(
      repoPaths
        .map((repoPath) => repoPath.trim())
        .filter(Boolean)
        .map((repoPath) => normalizeAbsolutePath(repoPath)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  for (let index = 0; index < normalized.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < normalized.length; compareIndex += 1) {
      if (pathContainsPath(normalized[index], normalized[compareIndex])) {
        return true;
      }
    }
  }

  return false;
}

async function isGitRepositoryRoot(dirPath: string): Promise<boolean> {
  const gitPath = path.join(dirPath, '.git');
  try {
    const gitStat = await fs.stat(gitPath);
    return gitStat.isDirectory() || gitStat.isFile();
  } catch {
    return false;
  }
}

async function listRepoBranches(repoPath: string): Promise<GitBranch[]> {
  try {
    const git = simpleGit(repoPath);
    const branchSummary = await git.branchLocal();
    return branchSummary.all.map((name) => ({
      name,
      current: branchSummary.current === name,
    }));
  } catch {
    return [];
  }
}

async function resolveProjectReference(projectIdOrPath: string): Promise<{
  projectId: string | null;
  projectPath: string | null;
  folderPaths: string[];
}> {
  const trimmedValue = projectIdOrPath.trim();
  if (!trimmedValue) {
    throw new Error('Project is required.');
  }

  const projectById = getProjectById(trimmedValue);
  if (projectById) {
    return {
      projectId: projectById.id,
      projectPath: getProjectPrimaryFolderPath(projectById),
      folderPaths: projectById.folderPaths,
    };
  }

  const normalizedPath = normalizeProjectFolderPath(trimmedValue);
  const projectByFolderPath = findProjectByFolderPath(normalizedPath);
  if (projectByFolderPath) {
    return {
      projectId: projectByFolderPath.id,
      projectPath: getProjectPrimaryFolderPath(projectByFolderPath),
      folderPaths: projectByFolderPath.folderPaths,
    };
  }

  const stat = await fs.stat(normalizedPath);
  if (!stat.isDirectory()) {
    throw new Error('Project path must be a directory.');
  }

  return {
    projectId: null,
    projectPath: normalizedPath,
    folderPaths: [normalizedPath],
  };
}

async function discoverGitReposInFolder(folderPath: string): Promise<{
  repos: string[];
  scannedDirs: number;
  truncated: boolean;
}> {
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: folderPath, depth: 0 }];
  const visited = new Set<string>();
  const discoveredRepos: string[] = [];
  let scannedDirs = 0;
  let truncated = false;

  for (let index = 0; index < queue.length; index += 1) {
    if (scannedDirs >= MAX_DISCOVERED_DIRS || discoveredRepos.length >= MAX_DISCOVERED_REPOS) {
      truncated = true;
      break;
    }

    const current = queue[index];
    if (current.depth > MAX_DISCOVERY_DEPTH) continue;

    const normalizedCurrentDir = normalizeAbsolutePath(current.dirPath);
    if (visited.has(normalizedCurrentDir)) continue;
    visited.add(normalizedCurrentDir);
    scannedDirs += 1;

    if (await isGitRepositoryRoot(normalizedCurrentDir)) {
      discoveredRepos.push(normalizedCurrentDir);
    }

    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(normalizedCurrentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (DISCOVERY_SKIP_DIRS.has(entry.name)) continue;
      queue.push({ dirPath: path.join(normalizedCurrentDir, entry.name), depth: current.depth + 1 });
    }
  }

  return {
    repos: Array.from(new Set(discoveredRepos)).sort((left, right) => left.localeCompare(right)),
    scannedDirs,
    truncated,
  };
}

function toDiscoveredRepoRelativePath(
  folderPath: string,
  repoPath: string,
  folderEntryName: string,
  hasMultipleFolders: boolean,
): string {
  const relativePath = path.relative(folderPath, repoPath);
  if (!hasMultipleFolders) {
    return relativePath === '.' ? '' : relativePath;
  }
  return relativePath === '.'
    ? folderEntryName
    : path.join(folderEntryName, relativePath);
}

export async function discoverProjectGitRepos(projectIdOrPath: string): Promise<DiscoverProjectGitReposResult> {
  const resolvedProject = await resolveProjectReference(projectIdOrPath);
  if (resolvedProject.folderPaths.length === 0) {
    return {
      repos: [],
      truncated: false,
      scannedDirs: 0,
      overlapDetected: false,
    };
  }

  const folderEntries = buildProjectFolderEntries(resolvedProject.folderPaths);
  const hasMultipleFolders = folderEntries.length > 1;
  const repos: DiscoveredProjectGitRepo[] = [];
  const seenRepoPaths = new Set<string>();
  let scannedDirs = 0;
  let truncated = false;

  for (const folderEntry of folderEntries) {
    const discovery = await discoverGitReposInFolder(folderEntry.sourcePath);
    scannedDirs += discovery.scannedDirs;
    truncated = truncated || discovery.truncated;

    for (const repoPath of discovery.repos) {
      if (seenRepoPaths.has(repoPath)) continue;
      seenRepoPaths.add(repoPath);
      repos.push({
        repoPath,
        relativePath: toDiscoveredRepoRelativePath(
          folderEntry.sourcePath,
          repoPath,
          folderEntry.entryName,
          hasMultipleFolders,
        ),
      });
    }
  }

  const sortedRepos = repos.sort((left, right) => left.repoPath.localeCompare(right.repoPath));
  return {
    repos: sortedRepos,
    truncated,
    scannedDirs,
    overlapDetected: hasOverlappingRepoRoots(sortedRepos.map((repo) => repo.repoPath)),
  };
}

export async function discoverProjectGitReposWithBranches(projectIdOrPath: string): Promise<DiscoverProjectGitReposWithBranchesResult> {
  const discovery = await discoverProjectGitRepos(projectIdOrPath);
  const branchEntries = await Promise.all(
    discovery.repos.map(async (repo) => [repo.repoPath, await listRepoBranches(repo.repoPath)] as const),
  );

  return {
    ...discovery,
    branchesByRepo: Object.fromEntries(branchEntries),
  };
}

export async function getProjectActivity(projectReference: string): Promise<ProjectActivityResult> {
  const [sessions, drafts] = await Promise.all([
    listSessions(projectReference),
    listDrafts(projectReference),
  ]);

  return { sessions, drafts };
}

export async function resolveProjectByName(projectName: string): Promise<ResolveProjectResult> {
  const trimmedName = projectName.trim();
  if (!trimmedName) {
    return { success: false, projectId: null, projectPath: null, error: 'Project name is required.' };
  }

  try {
    const normalizedQuery = trimmedName.toLowerCase();
    const matchingProject = getProjects().find((project) => (
      project.name.toLowerCase() === normalizedQuery
      || project.folderPaths.some((folderPath) => path.basename(folderPath).toLowerCase() === normalizedQuery)
    ));
    if (matchingProject) {
      return {
        success: true,
        projectId: matchingProject.id,
        projectPath: getProjectPrimaryFolderPath(matchingProject) ?? matchingProject.folderPaths[0] ?? null,
      };
    }

    const resolvedPath = await resolveRepositoryPathByName(trimmedName);
    if (!resolvedPath) {
      throw new Error('Project not found.');
    }
    const existingProject = findProjectByFolderPath(resolvedPath);
    if (existingProject) {
      return {
        success: true,
        projectId: existingProject.id,
        projectPath: getProjectPrimaryFolderPath(existingProject) ?? existingProject.folderPaths[0] ?? null,
      };
    }

    const project = addProject({
      name: path.basename(resolvedPath),
      folderPaths: [resolvedPath],
    });
    return {
      success: true,
      projectId: project.id,
      projectPath: resolvedPath,
    };
  } catch (error) {
    console.error('Failed to resolve project by name:', error);
    return {
      success: false,
      projectId: null,
      projectPath: null,
      error: 'Failed to search projects. Please try again.',
    };
  }
}

function getGitLabCredentialHost(credential: Credential): string | null {
  if (credential.type !== 'gitlab') return null;

  try {
    return new URL(credential.serverUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function pickCandidateCredential(
  credentials: Credential[],
  provider: 'github' | 'gitlab',
  remoteHost: string | null,
): Credential | null {
  if (provider === 'github') {
    return credentials.find((credential) => credential.type === 'github') || null;
  }

  if (remoteHost) {
    const hostMatch = credentials.find((credential) => (
      credential.type === 'gitlab'
      && getGitLabCredentialHost(credential) === remoteHost
    ));
    if (hostMatch) return hostMatch;
  }

  return credentials.find((credential) => credential.type === 'gitlab') || null;
}

function getProjectNameFromRemoteUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  let rawPath = '';

  try {
    const parsed = new URL(trimmed);
    rawPath = parsed.pathname;
  } catch {
    const scpLikeMatch = trimmed.match(/^([^@]+@)?([^:]+):(.+)$/);
    rawPath = scpLikeMatch ? scpLikeMatch[3] : trimmed;
  }

  const normalized = rawPath.replace(/\/+$/, '');
  if (!normalized) return null;

  let baseName = path.posix.basename(normalized);
  if (!baseName || baseName === '.' || baseName === '..') return null;

  if (baseName.toLowerCase().endsWith('.git')) {
    baseName = baseName.slice(0, -4);
  }

  const sanitized = baseName
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeErrorMessage(message: string, secretValues: string[]): string {
  let sanitized = message;

  for (const value of secretValues) {
    if (!value) continue;
    sanitized = sanitized.replace(new RegExp(escapeRegExp(value), 'g'), '***');
  }

  return sanitized.replace(/:\/\/[^/\s@]+@/g, '://***@');
}

function buildAuthenticatedCloneUrl(remoteUrl: string, credential: Credential, token: string): string {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return remoteUrl;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return remoteUrl;
  }

  if (credential.type === 'github') {
    parsed.username = 'x-access-token';
    parsed.password = token;
    return parsed.toString();
  }

  parsed.username = 'oauth2';
  parsed.password = token;
  return parsed.toString();
}

type CloneCredentialResolution =
  | { success: true; credential: Credential | null; token: string | null }
  | { success: false; error: string };

async function resolveCloneCredential(
  remoteUrl: string,
  credentialId: string | null,
): Promise<CloneCredentialResolution> {
  const allCredentials = await getAllCredentials();
  const provider = detectGitRemoteProvider(remoteUrl, {
    gitlabHosts: allCredentials.flatMap((credential) => {
      if (credential.type !== 'gitlab') return [];
      const host = getGitLabCredentialHost(credential);
      return host ? [host] : [];
    }),
  });
  const remoteHost = parseGitRemoteHost(remoteUrl);

  if (credentialId) {
    const selectedCredential = await getCredentialById(credentialId);
    if (!selectedCredential) {
      return { success: false, error: 'Selected credential was not found. Please choose another credential.' };
    }

    if (provider === 'github' && selectedCredential.type !== 'github') {
      return { success: false, error: 'Selected credential does not match this GitHub repository.' };
    }
    if (provider === 'gitlab' && selectedCredential.type !== 'gitlab') {
      return { success: false, error: 'Selected credential does not match this GitLab repository.' };
    }

    if (selectedCredential.type === 'gitlab' && remoteHost) {
      const credentialHost = getGitLabCredentialHost(selectedCredential);
      if (credentialHost && credentialHost !== remoteHost) {
        return {
          success: false,
          error: `Selected GitLab credential targets ${credentialHost}, but this repository uses ${remoteHost}.`,
        };
      }
    }

    const token = await getCredentialToken(selectedCredential.id);
    if (!token) {
      return { success: false, error: 'Could not load token for selected credential.' };
    }

    return { success: true, credential: selectedCredential, token };
  }

  if (!provider) {
    return { success: true, credential: null, token: null };
  }

  const candidate = pickCandidateCredential(allCredentials, provider, remoteHost);
  if (!candidate) {
    return { success: true, credential: null, token: null };
  }

  const token = await getCredentialToken(candidate.id);
  if (!token) {
    return { success: true, credential: null, token: null };
  }

  return { success: true, credential: candidate, token };
}

export async function cloneRemoteProject(
  remoteUrl: string,
  credentialId: string | null,
): Promise<CloneRemoteProjectResult> {
  const trimmedRemoteUrl = remoteUrl.trim();
  if (!trimmedRemoteUrl) {
    return { success: false, projectId: null, projectPath: null, error: 'Please enter a remote project URL.' };
  }

  const projectName = getProjectNameFromRemoteUrl(trimmedRemoteUrl);
  if (!projectName) {
    return { success: false, projectId: null, projectPath: null, error: 'Could not determine project name from URL.' };
  }

  const cloneRoot = path.join(os.homedir(), '.viba', 'projects');
  await fs.mkdir(cloneRoot, { recursive: true });

  const targetPath = path.join(cloneRoot, projectName);
  try {
    await fs.access(targetPath);
    return {
      success: false,
      projectId: null,
      projectPath: null,
      error: `Project already exists at ${targetPath}.`,
    };
  } catch {
    // Path does not exist yet.
  }

  const credentialResolution = await resolveCloneCredential(trimmedRemoteUrl, credentialId);
  if (!credentialResolution.success) {
    return { success: false, projectId: null, projectPath: null, error: credentialResolution.error };
  }

  const cloneUrl = (credentialResolution.credential && credentialResolution.token)
    ? buildAuthenticatedCloneUrl(trimmedRemoteUrl, credentialResolution.credential, credentialResolution.token)
    : trimmedRemoteUrl;

  const git = simpleGit();

  try {
    await git.clone(cloneUrl, targetPath);

    if (cloneUrl !== trimmedRemoteUrl) {
      const clonedRepoGit = simpleGit(targetPath);
      await clonedRepoGit.remote(['set-url', 'origin', trimmedRemoteUrl]);
    }

    const project = addProject({
      name: projectName,
      folderPaths: [targetPath],
    });

    return {
      success: true,
      projectId: project.id,
      projectPath: targetPath,
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeMessage = sanitizeErrorMessage(rawMessage, [
      cloneUrl,
      credentialResolution.token ?? '',
    ]);

    await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {
      // Ignore cleanup errors.
    });

    return {
      success: false,
      projectId: null,
      projectPath: null,
      error: safeMessage || 'Failed to clone project.',
    };
  }
}
