import { checkOrigin } from '@/lib/server/admin';
import { customerAccountFrom } from '@/lib/server/auth';
import { updateIdentity } from '@/lib/server/customerApprovals';
import { route } from '@/lib/server/route';

// A new ID photo or number sends the account for approval again.
export const POST = route(async (request) => {
  checkOrigin(request);
  return Response.json({ account: await updateIdentity(customerAccountFrom(request).username, request) });
});
