import { addAdmin, adminRoute, listAdmins } from '@/lib/server/admin';

export const GET = adminRoute('team', async () => Response.json({ admins: listAdmins() }));

export const POST = adminRoute('team', async (request, admin) => {
  await addAdmin(admin, await request.json());
  return new Response(null, { status: 201 });
});
