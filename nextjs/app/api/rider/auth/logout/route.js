import { logoutAccount } from '@/lib/server/auth';
import { route } from '@/lib/server/route';

export const POST = route(async () => {
  await logoutAccount('rider');
  return new Response(null, { status: 204 });
});
