import { NewProduct } from '@/components/ProductForm';

export const metadata = { title: 'Add New Product' };

export default async function NewProductPage({ searchParams }) {
  const { template } = await searchParams;
  return <NewProduct key={template} template={template} />;
}
