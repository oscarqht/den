import type { Metadata } from 'next';
import SettingsContent from '../credentials/credentials-content';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsPage() {
  return <SettingsContent />;
}
