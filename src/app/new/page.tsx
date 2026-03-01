import GitRepoSelector from '@/components/GitRepoSelector';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type PredefinedPrompt = {
  id: string;
  label: string;
  content: string;
};

const PREDEFINED_PROMPT_CONFIG = [
  { id: 'design', label: 'Design', fileName: 'design.md' },
  { id: 'performance', label: 'Performance', fileName: 'performance.md' },
  { id: 'security', label: 'Security', fileName: 'security.md' },
] as const;

async function loadJulesPredefinedPrompts(): Promise<PredefinedPrompt[]> {
  const promptDirectory = path.join(process.cwd(), 'docs/prompts/jules');

  const prompts = await Promise.all(
    PREDEFINED_PROMPT_CONFIG.map(async ({ id, label, fileName }) => {
      try {
        const content = (await readFile(path.join(promptDirectory, fileName), 'utf8')).trim();
        if (!content) return null;
        return { id, label, content };
      } catch (error) {
        console.error(`Failed to load predefined prompt: ${fileName}`, error);
        return null;
      }
    }),
  );

  const availablePrompts: PredefinedPrompt[] = [];
  for (const prompt of prompts) {
    if (prompt) {
      availablePrompts.push(prompt);
    }
  }

  return availablePrompts;
}

type NewSessionPageProps = {
  searchParams: Promise<{
    repo?: string | string[];
    from?: string | string[];
    prefillFromSession?: string | string[];
  }>;
};

export default async function NewSessionPage({ searchParams }: NewSessionPageProps) {
  const params = await searchParams;
  const predefinedPrompts = await loadJulesPredefinedPrompts();
  const repoParam = params.repo;
  const fromParam = params.from;
  const prefillParam = params.prefillFromSession;
  const repoPathFromParam = Array.isArray(repoParam) ? repoParam[0] : repoParam;
  const fromName = Array.isArray(fromParam) ? fromParam[0] : fromParam;
  const prefillFromSession = Array.isArray(prefillParam) ? prefillParam[0] : prefillParam;
  const repoPath = repoPathFromParam;

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#f6f6f8] p-4 md:p-8 dark:bg-[#0d1117]">
      <GitRepoSelector
        mode="new"
        repoPath={repoPath ?? null}
        fromRepoName={fromName ?? null}
        prefillFromSession={prefillFromSession ?? null}
        predefinedPrompts={predefinedPrompts}
      />
    </main>
  );
}
