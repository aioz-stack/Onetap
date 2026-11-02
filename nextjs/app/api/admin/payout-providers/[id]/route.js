import { adminRoute } from '@/lib/server/admin';
import { saveProvider } from '@/lib/server/payoutAccounts';

export const PATCH = adminRoute('cod', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ provider: saveProvider(admin, id, await request.json()) });
});
