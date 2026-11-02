import { AdminCustomers } from '@/components/admin/AdminCustomers';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Customer Approval' };

export default async function AdminCustomersPage({ searchParams }) {
  await pageAdmin('customers');
  return <AdminCustomers initial={await searchParams} />;
}
