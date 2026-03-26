import { headers } from 'next/headers';
import HomeDashboardContainer from '@/components/HomeDashboardContainer';
import { AppPageSurface } from '@/components/app-shell/AppPageSurface';
import { isAuth0Configured } from '@/lib/auth0';
import { isDirectLocalRequest } from '@/lib/request-origin';

export default async function Home() {
  const requestHeaders = await headers();
  const logoutEnabled = isAuth0Configured && !isDirectLocalRequest(requestHeaders);

  return (
    <AppPageSurface
      githubHref="https://github.com/m0o0scar/palx"
      contentClassName="flex min-h-screen flex-col items-center justify-start p-4 md:p-6"
    >
      <main className="relative z-10 flex w-full flex-col items-center justify-start transition-colors">
        <HomeDashboardContainer showLogout={logoutEnabled} logoutEnabled={logoutEnabled} />
      </main>
    </AppPageSurface>
  );
}
