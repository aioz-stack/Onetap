import { AdminPayoutAccounts } from '@/components/admin/AdminPayoutAccounts';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Payout Accounts' };

export default async function AdminPayoutAccountsPage({ searchParams }) {
  await pageAdmin('cod');
  return <AdminPayoutAccounts initial={await searchParams} />;
}
