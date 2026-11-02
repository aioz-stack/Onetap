import { checkOrigin } from '@/lib/server/admin';
import { customerAccountFrom } from '@/lib/server/auth';
import { profileFor, updateProfile } from '@/lib/server/customerApprovals';
import { route } from '@/lib/server/route';

export const dynamic = 'force-dynamic';

// My Profile, for a signed-in customer at any approval stage.
export const GET = route(async (request) => Response.json({ account: profileFor(customerAccountFrom(request).username) }));

export const PATCH = route(async (request) => {
  checkOrigin(request);
  return Response.json({ account: updateProfile(customerAccountFrom(request).username, await request.json()) });
});
