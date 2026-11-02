import { RiderShell } from '@/components/rider/RiderApp';
import { pageRider } from '@/lib/server/riders';

export default async function RiderPanelLayout({ children }) {
  const account = await pageRider();
  return <RiderShell account={{ name: account.name, partnerName: account.partnerName }}>{children}</RiderShell>;
}
