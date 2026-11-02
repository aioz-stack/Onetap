import { ToShip } from '@/components/SellerOrders';

export const metadata = { title: 'To Ship' };

export default async function ToShipPage({ searchParams }) {
  const { tab } = await searchParams;
  return <ToShip key={tab} tab={tab} />;
}
