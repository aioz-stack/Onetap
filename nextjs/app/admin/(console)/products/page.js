import { AdminProducts } from '@/components/admin/AdminProducts';
import { pageAdmin } from '@/lib/server/admin';

export const metadata = { title: 'Product Listings' };

export default async function AdminProductsPage({ searchParams }) {
  await pageAdmin('products');
  return <AdminProducts initial={await searchParams} />;
}
