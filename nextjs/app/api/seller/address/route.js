import { checkOrigin } from '@/lib/server/admin';
import { applicantFrom, saveAddress } from '@/lib/server/auth';
import { route } from '@/lib/server/route';

// A seller at any stage keeps their store address in the standard format.
export const POST = route(async (request) => {
  checkOrigin(request);
  return Response.json({ account: saveAddress('seller', applicantFrom(request), await request.json()) });
});
