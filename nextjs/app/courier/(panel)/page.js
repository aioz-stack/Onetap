import { CourierHome } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Dashboard' };

export default async function CourierHomePage() {
  await pageCourier();
  return <CourierHome />;
}
