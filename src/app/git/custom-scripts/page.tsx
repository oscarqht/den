import type { Metadata } from 'next';
import { getRepoDisplayNameFromConfig } from '@/lib/utils';
import CustomScriptsContentWrapper from './custom-scripts-content';

type PageProps = {
    searchParams: Promise<{ path?: string }>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
    const { path: repoPath } = await searchParams;
    const repoName = repoPath ? await getRepoDisplayNameFromConfig(repoPath) : 'Workspace';
    return { title: { absolute: `${repoName} | Custom Scripts` } };
}

export default function WorkspaceCustomScriptsPage() {
    return <CustomScriptsContentWrapper />;
}
