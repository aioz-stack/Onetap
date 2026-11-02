import { customerOrdersFrom } from '@/lib/server/auth';
import { applyCustomerAction } from '@/lib/server/orders';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  const { username } = customerOrdersFrom(request);
  const { ids, action, data } = await request.json();
  return Response.json({ orders: await applyCustomerAction(username, ids, action, data) });
});
