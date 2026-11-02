import { redirect } from 'next/navigation';
import { RiderLogin } from '@/components/rider/RiderApp';
import { currentRider } from '@/lib/server/riders';

export const metadata = { title: 'Log In' };

export default async function RiderLoginPage() {
  if (await currentRider()) redirect('/rider');
  return <RiderLogin />;
}
