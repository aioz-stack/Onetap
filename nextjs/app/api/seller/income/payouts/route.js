import { checkOrigin } from '@/lib/server/admin';
import { sellerFrom } from '@/lib/server/auth';
import { requestPayout, sellerPayouts } from '@/lib/server/sellerIncome';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ payouts: sellerPayouts(sellerFrom(request)) }));

export const POST = route(async (request) => {
  checkOrigin(request);
  return Response.json(requestPayout(sellerFrom(request), await request.json()), { status: 201 });
});
