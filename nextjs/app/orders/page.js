import { MyPurchases } from '@/components/CustomerOrders';

export const metadata = { title: 'My Purchases' };

export default async function MyPurchasesPage({ searchParams }) {
  const { tab } = await searchParams;
  return <MyPurchases key={tab} tab={tab} />;
}
