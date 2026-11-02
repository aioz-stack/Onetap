import { CourierShipments } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Shipments' };

export default async function CourierShipmentsPage({ searchParams }) {
  await pageCourier();
  return <CourierShipments initial={await searchParams} />;
}
