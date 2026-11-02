import { checkOrigin } from '@/lib/server/admin';
import { customerAccountFrom } from '@/lib/server/auth';
import { sendCode } from '@/lib/server/phoneVerification';
import { route } from '@/lib/server/route';

// Texts a 6-digit code to a mobile number, for registration or a contact change in My Profile.
export const POST = route(async (request) => {
  checkOrigin(request);
  const { contact, purpose } = await request.json();
  const username = purpose === 'profile' ? customerAccountFrom(request).username : '';
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return Response.json(await sendCode({ contact, purpose, username, ip }));
});
