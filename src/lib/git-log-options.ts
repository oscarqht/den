export type GitLogFormat = {
  hash: string;
  parents: string;
  date: string;
  message: string;
  refs: string;
  author_name: string;
  author_email: string;
  body: string;
};

export type GitLogOptions = {
  '--decorate': 'short';
  '--all'?: null;
  maxCount: number;
  format: GitLogFormat;
};

export function createGitLogOptions(limit: number, includeAll: boolean): GitLogOptions {
  return {
    // Keep refs stable regardless of user-level git config (e.g. log.decorate=full).
    '--decorate': 'short',
    ...(includeAll ? { '--all': null } : {}),
    maxCount: limit,
    format: {
      hash: '%h',
      parents: '%p',
      date: '%ai',
      message: '%s',
      refs: '%d',
      author_name: '%an',
      author_email: '%ae',
      body: '%b',
    },
  };
}
