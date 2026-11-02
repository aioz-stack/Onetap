import { AdminLogistics } from '@/components/admin/AdminLogistics';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Logistics Partners' };

export default async function AdminLogisticsPage() {
  await pageAdmin('logistics');
  return <AdminLogistics />;
}
