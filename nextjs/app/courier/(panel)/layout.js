import { CourierShell } from '@/components/courier/CourierPanel';
import { pageCourier } from '@/lib/server/courierPanel';

export default async function CourierPanelLayout({ children }) {
  const account = await pageCourier();
  return <CourierShell account={account}>{children}</CourierShell>;
}
