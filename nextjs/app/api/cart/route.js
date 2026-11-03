import { customerAccountFrom } from '@/lib/server/auth';
import { readCart, updateCart } from '@/lib/server/cart';
import { checkOrigin } from '@/lib/server/admin';
import { route } from '@/lib/server/route';

// The signed-in customer's own cart. Pending and rejected customers can fill a cart too, so this
// uses customerAccountFrom; checkout itself needs an approved customer.
export const GET = route(async (request) => Response.json({ items: readCart(customerAccountFrom(request).username) }));

export const POST = route(async (request) => {
  checkOrigin(request);
  const customer = customerAccountFrom(request);
  return Response.json({ items: updateCart(customer.username, await request.json()) });
});
