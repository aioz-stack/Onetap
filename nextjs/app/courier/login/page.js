import { redirect } from 'next/navigation';
import { CourierLogin } from '@/components/courier/CourierPanel';
import { currentCourier } from '@/lib/server/courierPanel';

export const metadata = { title: 'Log In' };

export default async function CourierLoginPage() {
  if (await currentCourier()) redirect('/courier');
  return <CourierLogin />;
}
