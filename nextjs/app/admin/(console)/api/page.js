import { AdminApi } from '@/components/admin/AdminLogistics';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'API Configuration' };

export default async function AdminApiPage() {
  await pageAdmin('api');
  return <AdminApi />;
}
