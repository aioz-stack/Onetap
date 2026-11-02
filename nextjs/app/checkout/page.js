import { redirect } from 'next/navigation';
import Checkout from '@/components/Checkout';
import { currentAccount } from '@/lib/server/auth';

export const metadata = { title: 'Checkout' };

export default async function CheckoutPage() {
  const customer = await currentAccount('customer');
  if (customer?.approvalStatus !== 'approved') redirect('/');
  return <Checkout customer={customer} />;
}
