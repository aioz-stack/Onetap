import { AdminFees } from '@/components/admin/AdminFees';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Fee Management' };

export default async function AdminFeesPage() {
  await pageAdmin('fees');
  return <AdminFees />;
}
