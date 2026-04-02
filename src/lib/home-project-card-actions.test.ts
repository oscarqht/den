import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldShowHomeProjectGitAction } from './home-project-card-actions.ts';

describe('shouldShowHomeProjectGitAction', () => {
  it('hides the git action before repository discovery resolves', () => {
    assert.equal(shouldShowHomeProjectGitAction(undefined), false);
  });

  it('hides the git action when discovery resolves with no repositories', () => {
    assert.equal(shouldShowHomeProjectGitAction([]), false);
  });

  it('shows the git action when at least one repository is discovered', () => {
    assert.equal(shouldShowHomeProjectGitAction([
      { repoPath: '/tmp/project', label: 'project' },
    ]), true);
  });
});
