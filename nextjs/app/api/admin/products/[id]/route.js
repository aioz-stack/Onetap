import { adminRoute } from '@/lib/server/admin';
import { decideListing, listingDetail } from '@/lib/server/moderation';

export const GET = adminRoute('products', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ listing: listingDetail(id) });
});

export const POST = adminRoute('products', async (request, admin, { params }) => {
  const { id } = await params;
  const { action, reason } = await request.json();
  return Response.json({ listing: decideListing(admin, id, action, reason) });
});
