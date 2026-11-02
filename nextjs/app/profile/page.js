import { redirect } from 'next/navigation';
import CustomerProfile from '@/components/CustomerProfile';
import { currentAccount } from '@/lib/server/auth';

export const metadata = { title: 'My Profile' };

// Open to a signed-in customer at any approval stage, so they can see and fix their details.
export default async function ProfilePage() {
  if (!await currentAccount('customer')) redirect('/');
  return <CustomerProfile />;
}
