import { PurchaseDetail } from '@/components/CustomerOrders';

export const metadata = { title: 'Order Details' };

export default async function PurchaseDetailPage({ params }) {
  const { id } = await params;
  return <PurchaseDetail id={id} />;
}
