import { sellerFrom } from '@/lib/server/auth';
import { ApiError } from '@/lib/server/errors';
import { sellerCancel, sellerReschedule } from '@/lib/server/pickups';
import { route } from '@/lib/server/route';

export const POST = route(async (request, { params }) => {
  const seller = sellerFrom(request);
  const { id } = await params;
  const { action, date, slot } = await request.json();
  if (action === 'reschedule') await sellerReschedule(seller, id, { date, slot });
  else if (action === 'cancel') await sellerCancel(seller, id);
  else throw new ApiError(400, 'Unknown action.');
  return new Response(null, { status: 204 });
});
