import { adminRoute } from '@/lib/server/admin';
import { ApiError } from '@/lib/server/errors';
import { approvePickup, cancelPickup, pickupDetail, rejectPickup, reschedulePickup, retryBooking, returnToReview } from '@/lib/server/pickups';

export const GET = adminRoute('pickups', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ pickup: pickupDetail(id) });
});

export const POST = adminRoute('pickups', async (request, admin, { params }) => {
  const { id } = await params;
  const { action, date, slot, courier, reason } = await request.json();
  if (action === 'approve') await approvePickup(admin, id, courier);
  else if (action === 'reject') rejectPickup(admin, id, reason);
  else if (action === 'retry') await retryBooking(admin, id);
  else if (action === 'return') await returnToReview(admin, id);
  else if (action === 'reschedule') await reschedulePickup(admin, id, date, slot);
  else if (action === 'cancel') await cancelPickup(admin, id);
  else throw new ApiError(400, 'Unknown action.');
  return Response.json({ pickup: pickupDetail(id) });
});
