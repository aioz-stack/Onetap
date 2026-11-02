import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server/auth';

// My Purchases opens once a customer is approved, and stays open while a change of ID or name
// is checked again.
export default async function OrdersLayout({ children }) {
  const customer = await currentAccount('customer');
  if (customer?.approvalStatus !== 'approved' && !customer?.verifiedBefore) redirect('/');
  return children;
}
