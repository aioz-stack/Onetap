import { adminRoute } from '@/lib/server/admin';
import { decideStreetRequest } from '@/lib/server/streets';

export const POST = adminRoute('logistics', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ request: decideStreetRequest(admin, id, await request.json()) });
});
