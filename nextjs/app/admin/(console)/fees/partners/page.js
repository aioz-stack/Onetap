import { AdminPartnerFees } from '@/components/admin/AdminFees';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Logistic Fee · Partners' };

export default async function AdminPartnerFeesPage({ searchParams }) {
  await pageAdmin('fees');
  return <AdminPartnerFees initial={await searchParams} />;
}
