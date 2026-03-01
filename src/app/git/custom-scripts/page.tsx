'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWorkspaceTitle } from '@/hooks/use-workspace-title';
import { useRepositories, useRepository, useUpdateRepository } from '@/hooks/use-git';
import { RepositoryCustomScript, RepositoryCustomScriptAction, RepositoryCustomScriptTarget } from '@/lib/types';

type ScriptDraft = {
  name: string;
  target: RepositoryCustomScriptTarget;
  action: RepositoryCustomScriptAction;
  content: string;
};

const EMPTY_DRAFT: ScriptDraft = {
  name: '',
  target: 'branch',
  action: 'run-bash-script',
  content: '',
};

function generateScriptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function WorkspaceCustomScriptsContent() {
  const searchParams = useSearchParams();
  const repoPath = searchParams.get('path');

  useWorkspaceTitle(repoPath, 'Custom scripts');

  const { isLoading: isReposLoading } = useRepositories();
  const repository = useRepository(repoPath);
  const updateRepository = useUpdateRepository();

  const scripts = useMemo(() => repository?.customScripts ?? [], [repository?.customScripts]);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScriptDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  if (isReposLoading) {
    return <div className="flex items-center justify-center h-full"><span className="loading loading-spinner"></span></div>;
  }

  if (!repoPath || !repository) {
    return <div className="p-8">Repository not found.</div>;
  }

  const resetForm = () => {
    setDraft(EMPTY_DRAFT);
    setEditingScriptId(null);
    setFormError(null);
  };

  const saveScripts = (nextScripts: RepositoryCustomScript[]) => {
    updateRepository.mutate({
      path: repoPath,
      updates: {
        customScripts: nextScripts,
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const name = draft.name.trim();
    const content = draft.content;

    if (!name) {
      setFormError('Script name is required.');
      return;
    }

    if (!content.trim()) {
      setFormError('Script content is required.');
      return;
    }

    const nextScript: RepositoryCustomScript = {
      id: editingScriptId || generateScriptId(),
      name,
      target: draft.target,
      action: draft.action,
      content,
    };

    const nextScripts = editingScriptId
      ? scripts.map((script) => (script.id === editingScriptId ? nextScript : script))
      : [...scripts, nextScript];

    saveScripts(nextScripts);
    resetForm();
  };

  const handleEdit = (script: RepositoryCustomScript) => {
    setEditingScriptId(script.id);
    setDraft({
      name: script.name,
      target: script.target,
      action: script.action,
      content: script.content,
    });
    setFormError(null);
  };

  const handleDelete = (scriptId: string) => {
    const nextScripts = scripts.filter((script) => script.id !== scriptId);
    saveScripts(nextScripts);
    if (editingScriptId === scriptId) {
      resetForm();
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Custom Scripts</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Manage custom bash scripts for this repository. Scripts appear in branch context menus.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-semibold mb-4">{editingScriptId ? 'Edit Script' : 'New Script'}</h2>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Name</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Example: Run tests"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Target</span>
                  </label>
                  <select
                    className="select select-bordered w-full"
                    value={draft.target}
                    onChange={(e) => setDraft((prev) => ({ ...prev, target: e.target.value as RepositoryCustomScriptTarget }))}
                  >
                    <option value="branch">Branch</option>
                  </select>
                </div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Action</span>
                  </label>
                  <select
                    className="select select-bordered w-full"
                    value={draft.action}
                    onChange={(e) => setDraft((prev) => ({ ...prev, action: e.target.value as RepositoryCustomScriptAction }))}
                  >
                    <option value="run-bash-script">Run bash script</option>
                  </select>
                </div>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text">Script Content</span>
                </label>
                <textarea
                  className="textarea textarea-bordered w-full h-56 font-mono text-sm"
                  value={draft.content}
                  onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
                  placeholder={'#!/usr/bin/env bash\nset -euo pipefail\n\necho "Hello from custom script"'}
                />
              </div>

              {formError && (
                <div className="alert alert-error py-2">
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={updateRepository.isPending}>
                  {editingScriptId ? 'Update Script' : 'Add Script'}
                </button>
                {editingScriptId && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm} disabled={updateRepository.isPending}>
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-semibold mb-4">Saved Scripts</h2>
            {scripts.length === 0 ? (
              <p className="text-sm opacity-60">No custom scripts yet.</p>
            ) : (
              <div className="space-y-3">
                {scripts.map((script) => (
                  <div key={script.id} className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50/60 dark:bg-slate-900/60">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{script.name}</div>
                        <div className="text-xs opacity-60 mt-1">
                          Target: Branch | Action: Run bash script
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button className="btn btn-ghost btn-xs" onClick={() => handleEdit(script)} disabled={updateRepository.isPending}>
                          Edit
                        </button>
                        <button className="btn btn-ghost btn-xs text-error" onClick={() => handleDelete(script.id)} disabled={updateRepository.isPending}>
                          Delete
                        </button>
                      </div>
                    </div>
                    <pre className="mt-3 text-xs font-mono bg-slate-100 dark:bg-slate-800 rounded p-3 overflow-auto max-h-36 whitespace-pre-wrap break-words">{script.content}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceCustomScriptsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><span className="loading loading-spinner"></span></div>}>
      <WorkspaceCustomScriptsContent />
    </Suspense>
  );
}
