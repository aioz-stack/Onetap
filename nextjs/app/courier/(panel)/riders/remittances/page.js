import { CourierRiderRemittances } from '@/components/courier/CourierRiders';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Rider Remittances' };

export default async function CourierRiderRemittancesPage({ searchParams }) {
  await pageCourier();
  return <CourierRiderRemittances initial={await searchParams} />;
}
