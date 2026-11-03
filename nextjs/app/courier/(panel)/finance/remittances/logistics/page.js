import { CourierLogisticsRemittance } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Logistics Remittance' };

export default async function LogisticsRemittancePage({ searchParams }) {
  await pageCourier();
  return <CourierLogisticsRemittance initial={await searchParams} />;
}
