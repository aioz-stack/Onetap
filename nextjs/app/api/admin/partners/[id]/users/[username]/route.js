import { adminRoute } from '@/lib/server/admin';
import { listCourierUsers, updateCourierUser } from '@/lib/server/courierUsers';

export const PATCH = adminRoute('logistics', async (request, admin, { params }) => {
  const { id, username } = await params;
  await updateCourierUser(admin, id, username, await request.json());
  return Response.json({ users: listCourierUsers(id) });
});
