import { checkOrigin } from '@/lib/server/admin';
import { sellerFrom } from '@/lib/server/auth';
import { cancelPayout } from '@/lib/server/sellerIncome';
import { route } from '@/lib/server/route';

// A seller cancels a payout that hasn't started processing.
export const DELETE = route(async (request, { params }) => {
  checkOrigin(request);
  const { id } = await params;
  cancelPayout(sellerFrom(request), id);
  return new Response(null, { status: 204 });
});
