'use server';

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

async function getDraftsDir(): Promise<string> {
  const homedir = os.homedir();
  const draftsDir = path.join(homedir, '.viba', 'drafts');
  try {
    await fs.mkdir(draftsDir, { recursive: true });
  } catch {
    // Ignore if exists
  }
  return draftsDir;
}

export async function saveDraft(draft: DraftMetadata): Promise<{ success: boolean; error?: string }> {
  try {
    const draftsDir = await getDraftsDir();
    const safeId = path.basename(draft.id);
    const filePath = path.join(draftsDir, `${safeId}.json`);
    await fs.writeFile(filePath, JSON.stringify(draft, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    console.error('Failed to save draft:', e);
    return { success: false, error: 'Failed to save draft' };
  }
}

export async function listDrafts(repoPath?: string): Promise<DraftMetadata[]> {
  try {
    const draftsDir = await getDraftsDir();
    const entries = await fs.readdir(draftsDir);

    const draftPromises = entries
      .filter((entry) => entry.endsWith('.json'))
      .map(async (entry) => {
        try {
          const filePath = path.join(draftsDir, entry);
          const content = await fs.readFile(filePath, 'utf-8');
          return JSON.parse(content) as DraftMetadata;
        } catch (e) {
          console.error(`Failed to parse draft file ${entry}:`, e);
          return null;
        }
      });

    const drafts = (await Promise.all(draftPromises)).filter((d): d is DraftMetadata => d !== null);

    if (repoPath) {
      return drafts.filter((d) => d.repoPath === repoPath).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    return drafts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      return [];
    }
    console.error('Failed to list drafts:', e);
    return [];
  }
}

export async function deleteDraft(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const draftsDir = await getDraftsDir();
    const safeId = path.basename(id);
    const filePath = path.join(draftsDir, `${safeId}.json`);
    await fs.rm(filePath, { force: true });
    return { success: true };
  } catch (e) {
    console.error('Failed to delete draft:', e);
    return { success: false, error: 'Failed to delete draft' };
  }
}
