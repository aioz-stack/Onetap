import { adminRoute } from '@/lib/server/admin';
import { applicationDetail, decideApplication } from '@/lib/server/applications';

export const GET = adminRoute('sellers', async (request, admin, { params }) => {
  const { username } = await params;
  return Response.json({ application: applicationDetail(username) });
});

export const POST = adminRoute('sellers', async (request, admin, { params }) => {
  const { username } = await params;
  const { action, reason } = await request.json();
  return Response.json({ application: decideApplication(admin, username, action, reason) });
});
