import type { Metadata } from 'next';
import AgentUsageContent from './agent-usage-content';

export const metadata: Metadata = {
  title: 'Agent Usage',
};

export default function AgentUsagePage() {
  return <AgentUsageContent />;
}
