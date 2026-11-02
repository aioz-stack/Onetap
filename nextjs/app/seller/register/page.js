import { redirect } from 'next/navigation';
import { SellerPortal } from '@/components/Auth';
import { currentAccount } from '@/lib/server/auth';

export default async function SellerRegisterPage() {
  if (await currentAccount('seller')) redirect('/seller/dashboard');
  return <SellerPortal mode="register" />;
}
