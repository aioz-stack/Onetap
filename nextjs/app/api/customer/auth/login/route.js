import { loginAccount } from '@/lib/server/auth';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  const { identifier, password } = await request.json();
  return Response.json({ account: await loginAccount('customer', request, identifier, password) });
});
