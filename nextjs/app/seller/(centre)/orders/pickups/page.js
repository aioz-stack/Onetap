import { SellerPickups } from '@/components/SellerPickups';

export const metadata = { title: 'Pickup Requests' };

export default async function PickupsPage({ searchParams }) {
  const { status } = await searchParams;
  return <SellerPickups initial={status ? { status } : {}} />;
}
