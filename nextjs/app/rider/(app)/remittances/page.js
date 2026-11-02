import { RiderRemittances } from '@/components/rider/RiderApp';
import { pageRider } from '@/lib/server/riders';

export const metadata = { title: 'Remittances' };

export default async function RiderRemittancesPage() {
  await pageRider();
  return <RiderRemittances />;
}
