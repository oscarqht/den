import assert from 'node:assert/strict';
import test from 'node:test';
import { filterHomeProjects, getHomeDashboardRenderState } from './home-dashboard-state.ts';
import { sortHomeProjects } from './home-project-sort.ts';

test('renders the project grid once bootstrap data is ready even if activity is still loading', () => {
  const renderState = getHomeDashboardRenderState({
    isBootstrapLoaded: true,
    isActivityLoaded: false,
    filteredRecentProjects: ['project-a'],
    homeSearchQuery: '',
  });

  assert.deepEqual(renderState, { kind: 'grid' });
});

test('returns the expected empty-state message after bootstrap completes', () => {
  const emptyState = getHomeDashboardRenderState({
    isBootstrapLoaded: true,
    isActivityLoaded: true,
    filteredRecentProjects: [],
    homeSearchQuery: 'docs',
  });

  assert.deepEqual(emptyState, {
    kind: 'empty',
    emptyMessage: 'No projects match your search.',
  });
});

test('filters sorted project references by display name and secondary label', () => {
  const sortedProjects = sortHomeProjects(
    ['project-zeta', 'project-alpha', 'project-beta'],
    'name',
    (projectReference) => ({
      'project-zeta': 'Zeta',
      'project-alpha': 'Alpha',
      'project-beta': 'Beta',
    }[projectReference] ?? projectReference),
  );

  const filtered = filterHomeProjects(
    sortedProjects,
    'workspace/beta',
    (projectReference) => ({
      'project-zeta': 'Zeta',
      'project-alpha': 'Alpha',
      'project-beta': 'Beta',
    }[projectReference] ?? projectReference),
    (projectReference) => ({
      'project-zeta': '/workspace/zeta',
      'project-alpha': '/workspace/alpha',
      'project-beta': '/workspace/beta',
    }[projectReference] ?? projectReference),
  );

  assert.deepEqual(filtered, ['project-beta']);
});
