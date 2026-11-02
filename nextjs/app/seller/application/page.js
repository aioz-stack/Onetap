import { redirect } from 'next/navigation';
import SellerApplication from '@/components/SellerApplication';
import { currentAccount } from '@/lib/server/auth';

export const metadata = { title: 'Seller Application' };

export default async function SellerApplicationPage() {
  if (!await currentAccount('seller')) redirect('/seller/login');
  return <SellerApplication />;
}
