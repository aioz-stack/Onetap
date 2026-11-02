import { sellerFrom } from '@/lib/server/auth';
import { changeStatus, deleteProduct, getProduct, updateProduct } from '@/lib/server/products';
import { route } from '@/lib/server/route';

export const GET = route(async (request, { params }) => {
  const { id } = await params;
  return Response.json({ product: getProduct(sellerFrom(request), id) });
});

export const PUT = route(async (request, { params }) => {
  const { id } = await params;
  const { product, action } = await request.json();
  return Response.json({ product: updateProduct(sellerFrom(request), id, product, action) });
});

export const PATCH = route(async (request, { params }) => {
  const { id } = await params;
  const { action } = await request.json();
  return Response.json({ product: changeStatus(sellerFrom(request), id, action) });
});

export const DELETE = route(async (request, { params }) => {
  const { id } = await params;
  deleteProduct(sellerFrom(request), id);
  return new Response(null, { status: 204 });
});
