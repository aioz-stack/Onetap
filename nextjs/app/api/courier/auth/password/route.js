import { changeCourierPassword, courierRoute } from '@/lib/server/courierPanel';

export const POST = courierRoute(async (request, account) => {
  const { current, next } = await request.json();
  await changeCourierPassword(account, current, next);
  return new Response(null, { status: 204 });
});
