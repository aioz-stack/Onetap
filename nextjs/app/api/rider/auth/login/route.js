import { riderLogin } from '@/lib/server/riders';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => {
  const { identifier, password } = await request.json();
  const { name } = await riderLogin(request, identifier, password);
  return Response.json({ account: { name } });
});
