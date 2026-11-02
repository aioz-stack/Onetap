import { CourierRiders } from '@/components/courier/CourierRiders';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Rider Management' };

export default async function CourierRidersPage({ searchParams }) {
  await pageCourier();
  return <CourierRiders initial={await searchParams} />;
}
