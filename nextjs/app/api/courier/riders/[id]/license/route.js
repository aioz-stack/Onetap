import { courierRoute } from '@/lib/server/courierPanel';
import { licenseResponse } from '@/lib/server/riders';

export const GET = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  return licenseResponse(account.partnerId, id);
});
