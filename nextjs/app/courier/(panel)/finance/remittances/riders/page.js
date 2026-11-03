import { CourierRiderRemittances } from '@/components/courier/CourierRiders';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Rider Remittance' };

export default async function RiderRemittancePage({ searchParams }) {
  await pageCourier();
  return <CourierRiderRemittances initial={await searchParams} />;
}
