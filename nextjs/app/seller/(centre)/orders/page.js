import { MyOrders } from '@/components/SellerOrders';

export const metadata = { title: 'My Orders' };

export default async function MyOrdersPage({ searchParams }) {
  const { tab } = await searchParams;
  return <MyOrders key={tab} tab={tab} />;
}
