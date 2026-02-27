export type TerminalSessionRole = 'agent' | 'terminal';
export type GitRemoteProvider = 'github' | 'gitlab';
export type TerminalSessionEnvironment = {
  name: string;
  value: string;
};
type DetectGitRemoteProviderOptions = {
  gitlabHosts?: string[];
};

function sanitizeTmuxSessionName(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  return safe || 'session';
}

export function getTmuxSessionName(sessionName: string, role: TerminalSessionRole): string {
  return `viba-${sanitizeTmuxSessionName(sessionName).slice(0, 40)}-${role}`;
}

function normalizeGitRemoteUrl(remoteUrl: string): string {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return '';

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const scpLikeMatch = trimmed.match(/^([^@]+@)?([^:]+):(.+)$/);
  if (!scpLikeMatch) {
    return '';
  }

  const userPart = scpLikeMatch[1] || '';
  const host = scpLikeMatch[2];
  const path = scpLikeMatch[3].replace(/^\/+/, '');
  return `ssh://${userPart}${host}/${path}`;
}

export function parseGitRemoteHost(remoteUrl: string): string | null {
  const normalized = normalizeGitRemoteUrl(remoteUrl);
  if (!normalized) return null;

  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function normalizeKnownHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    // Fall through to parse as a bare host (optionally with port).
  }

  try {
    return new URL(`ssh://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function detectGitRemoteProvider(
  remoteUrl: string,
  options?: DetectGitRemoteProviderOptions,
): GitRemoteProvider | null {
  const host = parseGitRemoteHost(remoteUrl);
  if (!host) return null;

  if (host === 'github.com' || host.includes('github')) {
    return 'github';
  }

  if (host === 'gitlab.com' || host.includes('gitlab')) {
    return 'gitlab';
  }

  if (options?.gitlabHosts?.some((knownHost) => normalizeKnownHost(knownHost) === host)) {
    return 'gitlab';
  }

  return null;
}

export function buildTtydTerminalSrc(
  sessionName: string,
  role: TerminalSessionRole,
  environment?: TerminalSessionEnvironment | TerminalSessionEnvironment[] | null,
): string {
  const tmuxSession = getTmuxSessionName(sessionName, role);
  const params = new URLSearchParams();
  params.append('arg', 'new-session');
  const environments = Array.isArray(environment)
    ? environment
    : environment
      ? [environment]
      : [];

  for (const env of environments) {
    if (!env.value) continue;
    params.append('arg', '-e');
    params.append('arg', `${env.name}=${env.value}`);
  }
  params.append('arg', '-A');
  params.append('arg', '-s');
  params.append('arg', tmuxSession);
  return `/terminal?${params.toString()}`;
}
