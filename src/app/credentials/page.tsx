'use client';

import { listCredentials, removeCredential, saveGitHubCredential, saveGitLabCredential } from '@/app/actions/credentials';
import type { Credential, CredentialType } from '@/lib/credentials';
import { ArrowLeft, Github, KeyRound, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const DEFAULT_GITLAB_SERVER_URL = 'https://gitlab.com';

type FlashMessage = {
  tone: 'success' | 'error';
  text: string;
} | null;

export default function CredentialsPage() {
  const router = useRouter();

  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);

  const [githubToken, setGitHubToken] = useState('');
  const [gitlabToken, setGitLabToken] = useState('');
  const [gitlabServerUrl, setGitLabServerUrl] = useState(DEFAULT_GITLAB_SERVER_URL);

  const [savingType, setSavingType] = useState<CredentialType | null>(null);
  const [deletingType, setDeletingType] = useState<CredentialType | null>(null);
  const [flashMessage, setFlashMessage] = useState<FlashMessage>(null);

  const githubCredential = useMemo(
    () => credentials.find((credential) => credential.type === 'github') || null,
    [credentials],
  );

  const gitlabCredential = useMemo(
    () => credentials.find((credential) => credential.type === 'gitlab') || null,
    [credentials],
  );

  const reloadCredentials = async () => {
    const result = await listCredentials();

    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setLoading(false);
      return;
    }

    setCredentials(result.credentials);
    const configuredGitLab = result.credentials.find((credential) => credential.type === 'gitlab');
    if (configuredGitLab && configuredGitLab.type === 'gitlab') {
      setGitLabServerUrl(configuredGitLab.serverUrl);
    }

    setLoading(false);
  };

  useEffect(() => {
    let isActive = true;

    void (async () => {
      const result = await listCredentials();
      if (!isActive) return;

      if (!result.success) {
        setFlashMessage({ tone: 'error', text: result.error });
        setLoading(false);
        return;
      }

      setCredentials(result.credentials);
      const configuredGitLab = result.credentials.find((credential) => credential.type === 'gitlab');
      if (configuredGitLab && configuredGitLab.type === 'gitlab') {
        setGitLabServerUrl(configuredGitLab.serverUrl);
      }
      setLoading(false);
    })();

    return () => {
      isActive = false;
    };
  }, []);

  const handleSaveGitHub = async () => {
    setFlashMessage(null);
    setSavingType('github');

    const result = await saveGitHubCredential(githubToken);
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setSavingType(null);
      return;
    }

    setGitHubToken('');
    setFlashMessage({ tone: 'success', text: 'GitHub credential saved.' });
    await reloadCredentials();
    setSavingType(null);
  };

  const handleSaveGitLab = async () => {
    setFlashMessage(null);
    setSavingType('gitlab');

    const result = await saveGitLabCredential(gitlabServerUrl, gitlabToken);
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setSavingType(null);
      return;
    }

    setGitLabToken('');
    setFlashMessage({ tone: 'success', text: 'GitLab credential saved.' });
    await reloadCredentials();
    setSavingType(null);
  };

  const handleDelete = async (type: CredentialType) => {
    const providerLabel = type === 'github' ? 'GitHub' : 'GitLab';
    const confirmed = confirm(`Delete the ${providerLabel} credential?`);
    if (!confirmed) return;

    setFlashMessage(null);
    setDeletingType(type);

    const result = await removeCredential(type);
    if (!result.success) {
      setFlashMessage({ tone: 'error', text: result.error });
      setDeletingType(null);
      return;
    }

    setFlashMessage({ tone: 'success', text: `${providerLabel} credential deleted.` });
    await reloadCredentials();
    setDeletingType(null);
  };

  return (
    <main className="min-h-screen bg-base-100 p-4 md:p-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="btn btn-ghost btn-sm" onClick={() => router.push('/')}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div>
              <h1 className="text-2xl font-semibold">Credentials</h1>
              <p className="text-sm opacity-70">GitHub and GitLab API tokens are stored securely in your system keychain.</p>
            </div>
          </div>
        </div>

        {flashMessage && (
          <div className={`alert ${flashMessage.tone === 'error' ? 'alert-error' : 'alert-success'} text-sm`}>
            {flashMessage.text}
          </div>
        )}

        {loading ? (
          <div className="card bg-base-200 shadow-xl">
            <div className="card-body items-center py-10">
              <span className="loading loading-spinner loading-md"></span>
              <p className="text-sm opacity-70">Loading credentials...</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="card bg-base-200 shadow-xl">
              <div className="card-body space-y-3">
                <h2 className="card-title flex items-center gap-2">
                  <Github className="h-5 w-5" />
                  GitHub
                </h2>

                <p className="text-sm opacity-80">
                  {githubCredential
                    ? `Configured for ${githubCredential.username} (updated ${new Date(githubCredential.updatedAt).toLocaleString()}).`
                    : 'No GitHub credential configured.'}
                </p>

                <label className="form-control w-full gap-2">
                  <span className="label-text text-xs uppercase tracking-wide opacity-70">Personal Access Token</span>
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    placeholder="ghp_xxx"
                    value={githubToken}
                    onChange={(event) => setGitHubToken(event.target.value)}
                    disabled={savingType === 'github'}
                  />
                </label>

                <div className="card-actions justify-end gap-2 pt-2">
                  {githubCredential && (
                    <button
                      className="btn btn-error btn-outline btn-sm"
                      onClick={() => void handleDelete('github')}
                      disabled={deletingType === 'github' || savingType === 'github'}
                    >
                      {deletingType === 'github' ? <span className="loading loading-spinner loading-xs"></span> : <Trash2 className="h-4 w-4" />}
                      Delete
                    </button>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleSaveGitHub()}
                    disabled={savingType === 'github'}
                  >
                    {savingType === 'github' ? <span className="loading loading-spinner loading-xs"></span> : <KeyRound className="h-4 w-4" />}
                    {githubCredential ? 'Update' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="card bg-base-200 shadow-xl">
              <div className="card-body space-y-3">
                <h2 className="card-title flex items-center gap-2">GitLab</h2>

                <p className="text-sm opacity-80">
                  {gitlabCredential && gitlabCredential.type === 'gitlab'
                    ? `Configured for ${gitlabCredential.username} on ${gitlabCredential.serverUrl} (updated ${new Date(gitlabCredential.updatedAt).toLocaleString()}).`
                    : 'No GitLab credential configured.'}
                </p>

                <label className="form-control w-full gap-2">
                  <span className="label-text text-xs uppercase tracking-wide opacity-70">Server URL</span>
                  <input
                    type="url"
                    className="input input-bordered w-full"
                    placeholder={DEFAULT_GITLAB_SERVER_URL}
                    value={gitlabServerUrl}
                    onChange={(event) => setGitLabServerUrl(event.target.value)}
                    disabled={savingType === 'gitlab'}
                  />
                </label>

                <label className="form-control w-full gap-2">
                  <span className="label-text text-xs uppercase tracking-wide opacity-70">Personal Access Token</span>
                  <input
                    type="password"
                    className="input input-bordered w-full"
                    placeholder="glpat-xxx"
                    value={gitlabToken}
                    onChange={(event) => setGitLabToken(event.target.value)}
                    disabled={savingType === 'gitlab'}
                  />
                </label>

                <div className="card-actions justify-end gap-2 pt-2">
                  {gitlabCredential && (
                    <button
                      className="btn btn-error btn-outline btn-sm"
                      onClick={() => void handleDelete('gitlab')}
                      disabled={deletingType === 'gitlab' || savingType === 'gitlab'}
                    >
                      {deletingType === 'gitlab' ? <span className="loading loading-spinner loading-xs"></span> : <Trash2 className="h-4 w-4" />}
                      Delete
                    </button>
                  )}
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleSaveGitLab()}
                    disabled={savingType === 'gitlab'}
                  >
                    {savingType === 'gitlab' ? <span className="loading loading-spinner loading-xs"></span> : <KeyRound className="h-4 w-4" />}
                    {gitlabCredential ? 'Update' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
