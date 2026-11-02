import { adminRoute } from '@/lib/server/admin';
import { listPickups, setPickupReview } from '@/lib/server/pickups';

export const GET = adminRoute('pickups', async (request) => listPickups(request.nextUrl.searchParams));

export const POST = adminRoute('pickups', async (request, admin) => {
  const { reviewRequired } = await request.json();
  setPickupReview(admin, Boolean(reviewRequired));
  return Response.json({ reviewRequired: Boolean(reviewRequired) });
});
