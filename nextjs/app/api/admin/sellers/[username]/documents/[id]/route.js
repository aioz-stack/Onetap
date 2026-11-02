import { adminRoute } from '@/lib/server/admin';
import { documentResponse } from '@/lib/server/applications';

export const GET = adminRoute('sellers', async (request, admin, { params }) => {
  const { username, id } = await params;
  return documentResponse(username, id);
});
