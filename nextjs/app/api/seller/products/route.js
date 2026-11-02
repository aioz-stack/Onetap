import { sellerFrom } from '@/lib/server/auth';
import { createProduct, listProducts } from '@/lib/server/products';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ products: listProducts(sellerFrom(request)) }));

export const POST = route(async (request) => {
  const seller = sellerFrom(request);
  const { product, action } = await request.json();
  return Response.json({ product: createProduct(seller, product, action) }, { status: 201 });
});
