'use server';

import {
  clearGlobalMemory,
  clearProjectMemory,
  readGlobalMemory,
  readProjectMemory,
  writeGlobalMemory,
  writeProjectMemory,
} from '@/lib/memory';

export async function getGlobalMemory() {
  return await readGlobalMemory();
}

export async function saveGlobalMemory(content: string) {
  return await writeGlobalMemory(content);
}

export async function resetGlobalMemory() {
  return await clearGlobalMemory();
}

export async function getProjectMemory(projectReference: string) {
  return await readProjectMemory(projectReference);
}

export async function saveProjectMemory(projectReference: string, content: string) {
  return await writeProjectMemory(projectReference, content);
}

export async function resetProjectMemory(projectReference: string) {
  return await clearProjectMemory(projectReference);
}
