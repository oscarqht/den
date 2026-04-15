import HomeDashboardContainer from '@/components/HomeDashboardContainer';
import { AppPageSurface } from '@/components/app-shell/AppPageSurface';

export default function Home() {
  return (
    <AppPageSurface
      githubHref="https://github.com/oscarqht/den"
      contentClassName="flex min-h-screen flex-col items-center justify-start p-4 md:p-6"
    >
      <main className="relative z-10 flex w-full flex-col items-center justify-start transition-colors">
        <HomeDashboardContainer />
      </main>
    </AppPageSurface>
  );
}
