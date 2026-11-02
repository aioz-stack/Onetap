import { RiderCollections } from '@/components/rider/RiderApp';
import { pageRider } from '@/lib/server/riders';

export const metadata = { title: 'Daily Collections' };

export default async function RiderCollectionsPage() {
  await pageRider();
  return <RiderCollections />;
}
