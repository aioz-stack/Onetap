import { customerFrom, customerOrdersFrom } from '@/lib/server/auth';
import { listCustomerOrders, placeOrders } from '@/lib/server/orders';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ orders: listCustomerOrders(customerOrdersFrom(request).username) }));

export const POST = route(async (request) => {
  const customer = customerFrom(request);
  return Response.json({ orders: placeOrders(customer, await request.json()) }, { status: 201 });
});
