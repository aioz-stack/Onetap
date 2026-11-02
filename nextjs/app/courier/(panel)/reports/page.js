import { CourierReports } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Delivery Performance' };

export default async function CourierReportsPage() {
  await pageCourier();
  return <CourierReports />;
}
