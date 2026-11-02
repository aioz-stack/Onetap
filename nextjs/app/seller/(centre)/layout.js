import { redirect } from 'next/navigation';
import SellerShell from '@/components/SellerShell';
import { currentAccount } from '@/lib/server/auth';

// Every Seller Centre page passes through here, so an unapproved seller can't reach one by URL.
export default async function SellerCentreLayout({ children }) {
  const seller = await currentAccount('seller');
  if (!seller) redirect('/seller/login');
  if (seller.applicationStatus !== 'approved') redirect('/seller/application');
  return <SellerShell account={seller}>{children}</SellerShell>;
}
