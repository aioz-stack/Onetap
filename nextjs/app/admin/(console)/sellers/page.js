import { AdminSellers } from '@/components/admin/AdminSellers';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Seller Registration Approval' };

export default async function AdminSellersPage({ searchParams }) {
  await pageAdmin('sellers');
  return <AdminSellers initial={await searchParams} />;
}
