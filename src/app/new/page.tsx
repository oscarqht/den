import type { Metadata } from 'next';
import NewSessionComposer from '@/components/NewSessionComposer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findProjectByFolderPath, getProjectById } from '@/lib/store';
import { getProjectPrimaryFolderPath } from '@/lib/project-folders';

export const metadata: Metadata = {
  title: 'New Session',
};

type PredefinedPrompt = {
  id: string;
  group: string;
  label: string;
  content: string;
};

const PREDEFINED_PROMPT_CONFIG = [
  {
    id: 'code-wiki',
    group: 'Documentation',
    label: 'Code Wiki',
    fileName: 'code-wiki.md',
  },
  {
    id: 'split-component',
    group: 'Refactor',
    label: 'Split Component',
    fileName: 'split-component.md',
  },
  {
    id: 'dedup',
    group: 'Refactor',
    label: 'Dedup',
    fileName: 'dedup.md',
  },
  {
    id: 'design',
    group: 'Design',
    label: 'Design',
    fileName: 'design.md',
  },
  {
    id: 'performance',
    group: 'Performance',
    label: 'Performance',
    fileName: 'performance.md',
  },
  {
    id: 'unit-test-guard',
    group: 'Test',
    label: 'Unit Test Guard',
    fileName: 'unit-test-guard.md',
  },
  {
    id: 'e2e-test-guard',
    group: 'Test',
    label: 'End-to-End Test Guard',
    fileName: 'e2e-test-guard.md',
  },
  {
    id: 'security',
    group: 'Security',
    label: 'Security',
    fileName: 'security.md',
  },
  {
    id: 'high-impact-bug-or-security',
    group: 'Security',
    label: 'Fix High-Impact Bug/Security',
    fileName: 'high-impact-bug-or-security.md',
  },
  {
    id: 'analyze-performance-recording',
    group: 'Performance',
    label: 'Analyze Performance Recording',
    fileName: 'analyze-performance-recording.md',
  },
  {
    id: 'update-dependencies',
    group: 'Maintenance',
    label: 'Update Dependencies',
    fileName: 'update-dependencies.md',
  },
  {
    id: 'observability-hardening',
    group: 'Reliability',
    label: 'Observability Hardening',
    fileName: 'observability-hardening.md',
  },
  {
    id: 'flaky-regression-guard',
    group: 'Reliability',
    label: 'Flaky Regression Guard',
    fileName: 'flaky-regression-guard.md',
  },
] as const;

async function loadJulesPredefinedPrompts(): Promise<PredefinedPrompt[]> {
  const promptDirectory = path.join(process.cwd(), 'src/prompts');

  const prompts = await Promise.all(
    PREDEFINED_PROMPT_CONFIG.map(async ({ id, group, label, fileName }) => {
      try {
        const content = (
          await readFile(path.join(promptDirectory, fileName), 'utf8')
        ).trim();
        if (!content) return null;
        return { id, group, label, content };
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
    project?: string | string[];
    projectId?: string | string[];
    from?: string | string[];
    prefillFromSession?: string | string[];
  }>;
};

function resolveProjectParamToPath(projectReference?: string | null): string | null {
  const trimmedReference = projectReference?.trim();
  if (!trimmedReference) return null;

  const projectById = getProjectById(trimmedReference);
  if (projectById) {
    return getProjectPrimaryFolderPath(projectById);
  }

  const projectByFolder = findProjectByFolderPath(trimmedReference);
  if (projectByFolder) {
    return getProjectPrimaryFolderPath(projectByFolder);
  }

  return trimmedReference;
}

export default async function NewSessionPage({
  searchParams,
}: NewSessionPageProps) {
  const params = await searchParams;
  const predefinedPrompts = await loadJulesPredefinedPrompts();
  const projectParam = params.project;
  const projectIdParam = params.projectId;
  const fromParam = params.from;
  const prefillParam = params.prefillFromSession;
  const projectPathFromParam = Array.isArray(projectParam) ? projectParam[0] : projectParam;
  const projectIdFromParam = Array.isArray(projectIdParam) ? projectIdParam[0] : projectIdParam;
  const fromName = Array.isArray(fromParam) ? fromParam[0] : fromParam;
  const prefillFromSession = Array.isArray(prefillParam)
    ? prefillParam[0]
    : prefillParam;
  const projectPath = resolveProjectParamToPath(projectIdFromParam ?? projectPathFromParam);

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#f6f6f8] p-4 md:p-8 dark:bg-[#0d1117]">
      <NewSessionComposer
        projectPath={projectPath ?? null}
        fromRepoName={fromName ?? null}
        prefillFromSession={prefillFromSession ?? null}
        predefinedPrompts={predefinedPrompts}
      />
    </main>
  );
}
