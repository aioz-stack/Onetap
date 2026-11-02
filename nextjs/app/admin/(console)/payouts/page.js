import { AdminPayouts } from '@/components/admin/AdminPayouts';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Seller Payouts' };

export default async function AdminPayoutsPage({ searchParams }) {
  await pageAdmin('cod');
  return <AdminPayouts initial={await searchParams} />;
}
