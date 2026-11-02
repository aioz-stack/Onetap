import { CourierPickups } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Assigned Pickups' };

export default async function CourierPickupsPage({ searchParams }) {
  await pageCourier();
  return <CourierPickups initial={await searchParams} />;
}
