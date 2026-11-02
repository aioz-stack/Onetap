import { adminRoute, updateAdmin } from '@/lib/server/admin';

export const PATCH = adminRoute('team', async (request, admin, { params }) => {
  const { username } = await params;
  updateAdmin(admin, username, await request.json());
  return new Response(null, { status: 204 });
});
