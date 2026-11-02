import { sellerFrom } from '@/lib/server/auth';
import { incomeRecord } from '@/lib/server/sellerIncome';
import { route } from '@/lib/server/route';

export const GET = route(async (request, { params }) => {
  const { orderId } = await params;
  return Response.json({ record: incomeRecord(sellerFrom(request), orderId) });
});
