import { redirect } from 'next/navigation';
import { currentAccount } from '@/lib/server/auth';

export default async function OrdersLayout({ children }) {
  if (!await currentAccount('customer')) redirect('/');
  return children;
}
