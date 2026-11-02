import { MyProducts } from '@/components/SellerProducts';

export const metadata = { title: 'My Products' };

export default async function MyProductsPage({ searchParams }) {
  const { tab } = await searchParams;
  return <MyProducts key={tab} tab={tab} />;
}
