import { checkOrigin } from '@/lib/server/admin';
import { customerAccountFrom } from '@/lib/server/auth';
import { approvalFor, updateIdentity } from '@/lib/server/customerApprovals';
import { route } from '@/lib/server/route';

export const dynamic = 'force-dynamic';

// The signed-in customer's own approval, at any stage.
export const GET = route(async (request) => Response.json({ approval: approvalFor(customerAccountFrom(request).username) }));

export const POST = route(async (request) => {
  checkOrigin(request);
  return Response.json({ approval: await updateIdentity(customerAccountFrom(request).username, request) });
});
