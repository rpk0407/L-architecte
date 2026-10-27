// The salon's settings: loaded once, as Shop stays mounted while moving between its sections. Each section edits a
// copy and saves in one go; the server validates everything again. The sections live in ./sections, listed in Reglages.tsx.
import type { ComponentType } from 'react';
import { useQuery } from '../../../lib/query';
import { Skeleton } from '../../../ui/kit';
import type { SectionProps, SettingsData } from './shared';

export default function Shop({ section: Section }: { section: ComponentType<SectionProps> }) {
  const { data, loading } = useQuery<SettingsData>('/api/v1/settings');
  if (loading && !data) return <Skeleton h={360} r={22} />;
  if (!data) return null;
  return <Section s={data.settings} data={data} />;
}
