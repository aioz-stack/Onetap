import { AdminCod } from '@/components/admin/AdminCod';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'COD Monitoring' };

export default async function AdminCodPage({ searchParams }) {
  await pageAdmin('cod');
  return <AdminCod initial={await searchParams} />;
}
