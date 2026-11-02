import { AdminPickups } from '@/components/admin/AdminShipments';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Pickup Approval' };

export default async function AdminPickupsPage({ searchParams }) {
  await pageAdmin('pickups');
  return <AdminPickups initial={await searchParams} />;
}
