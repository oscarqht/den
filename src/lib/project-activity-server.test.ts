import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type LocalDbModule = typeof import('./local-db.ts');
type ProjectActivityServerModule = typeof import('./project-activity-server.ts');
type StoreModule = typeof import('./store.ts');

let tempHome = '';
let previousHome = '';
let previousUserProfile = '';
let localDbModule: LocalDbModule;
let projectActivityServerModule: ProjectActivityServerModule;
let storeModule: StoreModule;

before(async () => {
  tempHome = await mkdtemp(path.join(os.tmpdir(), 'palx-project-activity-server-test-'));
  previousHome = process.env.HOME || '';
  previousUserProfile = process.env.USERPROFILE || '';
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  localDbModule = await import('./local-db.ts');
  projectActivityServerModule = await import('./project-activity-server.ts');
  storeModule = await import('./store.ts');
});

beforeEach(() => {
  localDbModule.resetLocalStateForTests();
  localDbModule.updateLocalState((state) => {
    state.sessions = {};
    state.drafts = {};
    state.projects = {};
  });
});

after(async () => {
  process.env.HOME = previousHome;
  process.env.USERPROFILE = previousUserProfile;
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true });
  }
});

function insertSessionRow(input: {
  sessionName: string;
  projectId?: string | null;
  projectPath?: string | null;
  repoPath?: string | null;
}) {
  localDbModule.updateLocalState((state) => {
    state.sessions[input.sessionName] = {
      sessionName: input.sessionName,
      projectId: input.projectId ?? null,
      projectPath: input.projectPath ?? '',
      workspacePath: input.projectPath ?? input.repoPath ?? '',
      workspaceMode: 'folder',
      activeRepoPath: input.repoPath ?? null,
      repoPath: input.repoPath ?? null,
      agent: 'codex',
      model: 'gpt-5.4',
      timestamp: '2026-03-30T07:00:00.000Z',
      gitRepos: [],
    };
  });
}

function insertDraftRow(input: {
  id: string;
  projectId?: string | null;
  projectPath?: string | null;
  repoPath?: string | null;
}) {
  localDbModule.updateLocalState((state) => {
    state.drafts[input.id] = {
      id: input.id,
      projectId: input.projectId ?? null,
      projectPath: input.projectPath ?? '',
      repoPath: input.repoPath ?? null,
      branchName: 'main',
      gitContextsJson: null,
      message: 'Draft body',
      attachmentPathsJson: '[]',
      agentProvider: 'codex',
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      timestamp: '2026-03-30T07:00:00.000Z',
      title: 'Draft title',
      startupScript: '',
      devServerScript: '',
      sessionMode: 'fast',
    };
  });
}

describe('project activity server helpers', () => {
  it('resolves both project ids and legacy folder paths to the canonical project_id filter', () => {
    const primaryPath = path.join(tempHome, 'project-primary');
    const secondaryPath = path.join(tempHome, 'project-secondary');
    const project = storeModule.addProject({
      name: 'Activity Project',
      folderPaths: [primaryPath, secondaryPath],
    });

    assert.deepEqual(
      projectActivityServerModule.resolveProjectActivityFilter(project.id),
      {
        projectId: project.id,
        projectPath: primaryPath,
        folderPaths: [primaryPath, secondaryPath],
        filterColumn: 'project_id',
        filterValue: project.id,
      },
    );

    assert.deepEqual(
      projectActivityServerModule.resolveProjectActivityFilter(secondaryPath),
      {
        projectId: project.id,
        projectPath: primaryPath,
        folderPaths: [primaryPath, secondaryPath],
        filterColumn: 'project_id',
        filterValue: project.id,
      },
    );
  });

  it('backfills legacy session rows using associated project folders', () => {
    const primaryPath = path.join(tempHome, 'session-project-primary');
    const secondaryPath = path.join(tempHome, 'session-project-secondary');
    const project = storeModule.addProject({
      name: 'Session Project',
      folderPaths: [primaryPath, secondaryPath],
    });

    insertSessionRow({
      sessionName: 'session-legacy',
      projectPath: secondaryPath,
      repoPath: path.join(secondaryPath, 'repo-b'),
    });

    projectActivityServerModule.repairMissingSessionProjectIds(project.id);

    const repairedRow = localDbModule.readLocalState().sessions['session-legacy'];
    assert.equal(repairedRow?.projectId, project.id);
  });

  it('backfills legacy draft rows using nested repo paths under associated folders', () => {
    const primaryPath = path.join(tempHome, 'draft-project-primary');
    const secondaryPath = path.join(tempHome, 'draft-project-secondary');
    const project = storeModule.addProject({
      name: 'Draft Project',
      folderPaths: [primaryPath, secondaryPath],
    });

    insertDraftRow({
      id: 'draft-legacy',
      projectPath: path.join(secondaryPath, 'nested-workspace'),
      repoPath: path.join(secondaryPath, 'nested-workspace', 'repo-b'),
    });

    projectActivityServerModule.repairMissingDraftProjectIds(secondaryPath);

    const repairedRow = localDbModule.readLocalState().drafts['draft-legacy'];
    assert.equal(repairedRow?.projectId, project.id);
  });
});
