import { RiderHome } from '@/components/rider/RiderApp';
import { pageRider } from '@/lib/server/riders';

export const metadata = { title: 'My Tasks' };

export default async function RiderHomePage() {
  await pageRider();
  return <RiderHome />;
}
