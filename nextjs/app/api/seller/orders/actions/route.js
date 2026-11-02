import { sellerFrom } from '@/lib/server/auth';
import { runSellerAction } from '@/lib/server/orders';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  const seller = sellerFrom(request);
  const { ids, action, data } = await request.json();
  return Response.json(await runSellerAction(seller, ids, action, data));
});
