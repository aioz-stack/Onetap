import { adminLogin } from '@/lib/server/admin';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  const { identifier, password } = await request.json();
  return Response.json({ account: await adminLogin(request, identifier, password) });
});
