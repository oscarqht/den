'use server';

import type { Project } from '../../lib/types.ts';
import { readLocalState } from '../../lib/local-db.ts';
import { getConfigFromLocalState } from '../../lib/config-state.ts';
import { getProjectsFromState } from '../../lib/store.ts';
import type { Config } from './config.ts';

export type HomeDashboardBootstrap = {
  projects: Project[];
  config: Config;
};

export async function getHomeDashboardBootstrap(): Promise<HomeDashboardBootstrap> {
  const state = readLocalState();

  return {
    projects: getProjectsFromState(state),
    config: getConfigFromLocalState(state),
  };
}
