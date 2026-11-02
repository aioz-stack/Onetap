import { courierLogin } from '@/lib/server/courierPanel';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  const { identifier, password } = await request.json();
  const { username, name, partnerId } = await courierLogin(request, identifier, password);
  return Response.json({ account: { username, name, partnerId } });
});
