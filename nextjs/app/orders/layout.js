import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server/auth';

// My Purchases opens once a customer's account is approved.
export default async function OrdersLayout({ children }) {
  if ((await currentAccount('customer'))?.approvalStatus !== 'approved') redirect('/');
  return children;
}
