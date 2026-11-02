import { checkOrigin } from '@/lib/server/admin';
import { customerAccountFrom } from '@/lib/server/auth';
import { verifyCode } from '@/lib/server/phoneVerification';
import { route } from '@/lib/server/route';

// Checks the code and returns a short-lived token that registration or My Profile spends.
export const POST = route(async (request) => {
  checkOrigin(request);
  const { contact, purpose, code } = await request.json();
  const username = purpose === 'profile' ? customerAccountFrom(request).username : '';
  return Response.json(verifyCode({ contact, purpose, username, code }));
});
