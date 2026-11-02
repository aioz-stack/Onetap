import { AdminCollections } from '@/components/admin/AdminCollections';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Financial Collections' };

export default async function AdminCollectionsPage({ searchParams }) {
  await pageAdmin('cod');
  return <AdminCollections initial={await searchParams} />;
}
