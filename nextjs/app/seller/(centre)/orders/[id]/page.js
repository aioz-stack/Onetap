import { OrderDetail } from '@/components/SellerOrders';

export async function generateMetadata({ params }) {
  const { id } = await params;
  return { title: `Order ${id}` };
}

export default async function OrderDetailPage({ params }) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}
