import { courierRoute } from '@/lib/server/courierPanel';
import { partnerRemittance, reviewRemittance } from '@/lib/server/riderCash';

export const GET = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  return Response.json({ remittance: partnerRemittance(account.partnerId, id) });
});

export const POST = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  return Response.json(reviewRemittance(account, id, await request.json()));
});
