'use client';

import GitRepoSelector from '@/components/GitRepoSelector';

type PredefinedPrompt = {
  id: string;
  group: string;
  label: string;
  content: string;
};

type NewSessionComposerProps = {
  projectPath?: string | null;
  fromRepoName?: string | null;
  prefillFromSession?: string | null;
  predefinedPrompts?: PredefinedPrompt[];
};

export default function NewSessionComposer({
  projectPath = null,
  fromRepoName = null,
  prefillFromSession = null,
  predefinedPrompts = [],
}: NewSessionComposerProps) {
  return (
    <GitRepoSelector
      mode="new"
      projectPath={projectPath}
      fromRepoName={fromRepoName}
      prefillFromSession={prefillFromSession}
      predefinedPrompts={predefinedPrompts}
    />
  );
}
