import { CourierProfile } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Company Profile' };

export default async function CourierProfilePage() {
  await pageCourier();
  return <CourierProfile />;
}
