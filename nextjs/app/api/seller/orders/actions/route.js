import { sellerFrom } from '@/lib/server/auth';
import { forSellerOrder, runSellerAction } from '@/lib/server/orders';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  const seller = sellerFrom(request);
  const { ids, action, data } = await request.json();
  const result = await runSellerAction(seller, ids, action, data);
  return Response.json({ ...result, orders: result.orders.map(forSellerOrder) });
});
