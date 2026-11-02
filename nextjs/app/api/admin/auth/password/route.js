import { adminRoute, changeAdminPassword } from '@/lib/server/admin';

export const POST = adminRoute(null, async (request, admin) => {
  const { current, next } = await request.json();
  await changeAdminPassword(admin, current, next);
  return new Response(null, { status: 204 });
});
