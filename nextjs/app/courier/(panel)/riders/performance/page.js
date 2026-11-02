import { CourierRiderPerformance } from '@/components/courier/CourierRiders';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Rider Performance' };

export default async function CourierRiderPerformancePage() {
  await pageCourier();
  return <CourierRiderPerformance />;
}
