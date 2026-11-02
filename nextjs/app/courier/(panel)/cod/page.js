import { CourierCod } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'COD Collections' };

export default async function CourierCodPage({ searchParams }) {
  await pageCourier();
  return <CourierCod initial={await searchParams} />;
}
