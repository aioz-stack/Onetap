import { checkOrigin } from '@/lib/server/admin';
import { sellerFrom } from '@/lib/server/auth';
import { addAccount, sellerAccounts } from '@/lib/server/payoutAccounts';
import { route } from '@/lib/server/route';

// The seller's saved withdrawal accounts, always masked, and the providers they can choose.
export const GET = route(async (request) => Response.json(sellerAccounts(sellerFrom(request))));

export const POST = route(async (request) => {
  checkOrigin(request);
  return Response.json({ account: addAccount(sellerFrom(request), await request.json()) }, { status: 201 });
});
