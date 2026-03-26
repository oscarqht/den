import type { Metadata } from 'next';
import { AppPageSurface } from '@/components/app-shell/AppPageSurface';
import SettingsContent from '../credentials/credentials-content';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsPage() {
  return (
    <AppPageSurface>
      <SettingsContent />
    </AppPageSurface>
  );
}
