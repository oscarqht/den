import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_HOME_PROJECT_SORT,
  normalizeHomeProjectSort,
  sortHomeProjects,
} from './home-project-sort.ts';

describe('home project sorting', () => {
  it('defaults unknown values to last-update', () => {
    assert.equal(normalizeHomeProjectSort(undefined), DEFAULT_HOME_PROJECT_SORT);
    assert.equal(normalizeHomeProjectSort('unexpected'), DEFAULT_HOME_PROJECT_SORT);
  });

  it('preserves recent project ordering for last-update sort', () => {
    const projects = ['/tmp/Zebra', '/tmp/alpha', '/tmp/Beta'];

    const sorted = sortHomeProjects(projects, 'last-update', (projectPath) => projectPath);

    assert.deepEqual(sorted, projects);
    assert.equal(sorted, projects);
  });

  it('sorts by project display name when requested', () => {
    const projects = ['/tmp/zeta', '/tmp/alpha-2', '/tmp/alpha-10', '/tmp/beta'];

    const sorted = sortHomeProjects(projects, 'name', (projectPath) => {
      switch (projectPath) {
        case '/tmp/zeta':
          return 'Zeta';
        case '/tmp/alpha-2':
          return 'alpha 2';
        case '/tmp/alpha-10':
          return 'Alpha 10';
        case '/tmp/beta':
          return 'beta';
        default:
          return projectPath;
      }
    });

    assert.deepEqual(sorted, ['/tmp/alpha-2', '/tmp/alpha-10', '/tmp/beta', '/tmp/zeta']);
  });
});
