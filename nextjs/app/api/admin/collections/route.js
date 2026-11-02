import { adminRoute } from '@/lib/server/admin';
import { collectionsReport, listCollections, setCommissionRate } from '@/lib/server/collections';

export const GET = adminRoute('cod', async (request) => {
  const params = request.nextUrl.searchParams;
  return params.get('period') ? collectionsReport(params) : listCollections(params);
});

export const POST = adminRoute('cod', async (request, admin) => {
  const { commissionRate } = await request.json();
  return Response.json({ commissionRate: setCommissionRate(admin, commissionRate) });
});
