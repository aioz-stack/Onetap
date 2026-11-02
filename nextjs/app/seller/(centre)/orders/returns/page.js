import { Returns } from '@/components/SellerOrders';

export const metadata = { title: 'Return / Refunds / Cancel' };

export default async function ReturnsPage({ searchParams }) {
  const { tab } = await searchParams;
  return <Returns key={tab} tab={tab} />;
}
