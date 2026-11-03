import { AdminStreets } from '@/components/admin/AdminStreets';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Street Requests' };

export default async function AdminStreetsPage({ searchParams }) {
  await pageAdmin('logistics');
  return <AdminStreets initial={await searchParams} />;
}
