import { AdminSellerFees } from '@/components/admin/AdminFees';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Admin Fee · Sellers' };

export default async function AdminSellerFeesPage({ searchParams }) {
  await pageAdmin('fees');
  return <AdminSellerFees initial={await searchParams} />;
}
