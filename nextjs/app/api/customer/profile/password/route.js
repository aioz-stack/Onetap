import { checkOrigin } from '@/lib/server/admin';
import { changeCustomerPassword } from '@/lib/server/auth';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  checkOrigin(request);
  await changeCustomerPassword(request, await request.json());
  return new Response(null, { status: 204 });
});
