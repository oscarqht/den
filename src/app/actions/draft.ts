'use server';

import path from 'node:path';
import { getLocalDb } from '@/lib/local-db';

export type DraftMetadata = {
  id: string;
  repoPath: string;
  branchName: string;
  message: string;
  attachmentPaths: string[];
  agentProvider: string;
  model: string;
  timestamp: string;
  title: string;
  startupScript: string;
  devServerScript: string;
  sessionMode: 'fast' | 'plan';
};

type DraftRow = {
  id: string;
  repo_path: string;
  branch_name: string;
  message: string;
  attachment_paths_json: string;
  agent_provider: string;
  model: string;
  timestamp: string;
  title: string;
  startup_script: string;
  dev_server_script: string;
  session_mode: string;
};

function parseAttachmentPaths(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function rowToDraft(row: DraftRow): DraftMetadata {
  return {
    id: row.id,
    repoPath: row.repo_path,
    branchName: row.branch_name,
    message: row.message,
    attachmentPaths: parseAttachmentPaths(row.attachment_paths_json),
    agentProvider: row.agent_provider,
    model: row.model,
    timestamp: row.timestamp,
    title: row.title,
    startupScript: row.startup_script,
    devServerScript: row.dev_server_script,
    sessionMode: row.session_mode === 'plan' ? 'plan' : 'fast',
  };
}

export async function saveDraft(draft: DraftMetadata): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getLocalDb();
    const safeId = path.basename(draft.id);
    db.prepare(`
      INSERT OR REPLACE INTO drafts (
        id, repo_path, branch_name, message, attachment_paths_json, agent_provider,
        model, timestamp, title, startup_script, dev_server_script, session_mode
      ) VALUES (
        @id, @repoPath, @branchName, @message, @attachmentPathsJson, @agentProvider,
        @model, @timestamp, @title, @startupScript, @devServerScript, @sessionMode
      )
    `).run({
      id: safeId,
      repoPath: draft.repoPath,
      branchName: draft.branchName,
      message: draft.message,
      attachmentPathsJson: JSON.stringify(draft.attachmentPaths),
      agentProvider: draft.agentProvider,
      model: draft.model,
      timestamp: draft.timestamp,
      title: draft.title,
      startupScript: draft.startupScript,
      devServerScript: draft.devServerScript,
      sessionMode: draft.sessionMode,
    });
    return { success: true };
  } catch (e) {
    console.error('Failed to save draft:', e);
    return { success: false, error: 'Failed to save draft' };
  }
}

export async function listDrafts(repoPath?: string): Promise<DraftMetadata[]> {
  try {
    const db = getLocalDb();
    const query = repoPath
      ? `
        SELECT
          id, repo_path, branch_name, message, attachment_paths_json, agent_provider,
          model, timestamp, title, startup_script, dev_server_script, session_mode
        FROM drafts
        WHERE repo_path = ?
        ORDER BY timestamp DESC
      `
      : `
        SELECT
          id, repo_path, branch_name, message, attachment_paths_json, agent_provider,
          model, timestamp, title, startup_script, dev_server_script, session_mode
        FROM drafts
        ORDER BY timestamp DESC
      `;

    const rows = repoPath
      ? (db.prepare(query).all(repoPath) as DraftRow[])
      : (db.prepare(query).all() as DraftRow[]);

    return rows.map(rowToDraft);
  } catch (e) {
    console.error('Failed to list drafts:', e);
    return [];
  }
}

export async function deleteDraft(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const db = getLocalDb();
    const safeId = path.basename(id);
    db.prepare(`
      DELETE FROM drafts WHERE id = ?
    `).run(safeId);
    return { success: true };
  } catch (e) {
    console.error('Failed to delete draft:', e);
    return { success: false, error: 'Failed to delete draft' };
  }
}
