import { adminRoute } from '@/lib/server/admin';
import { loadPartner } from '@/lib/server/couriers';
import { createCourierUser, listCourierUsers, prepareCourierUser } from '@/lib/server/courierUsers';

export const GET = adminRoute('logistics', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ users: listCourierUsers(id) });
});

export const POST = adminRoute('logistics', async (request, admin, { params }) => {
  const { id } = await params;
  loadPartner(id);
  createCourierUser(admin, id, await prepareCourierUser(await request.json()));
  return Response.json({ users: listCourierUsers(id) }, { status: 201 });
});
