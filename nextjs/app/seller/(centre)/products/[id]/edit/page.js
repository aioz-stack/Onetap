import { EditProduct } from '@/components/ProductForm';

export const metadata = { title: 'Edit Product' };

export default async function EditProductPage({ params }) {
  const { id } = await params;
  return <EditProduct id={id} />;
}
