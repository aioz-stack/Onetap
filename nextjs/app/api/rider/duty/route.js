import { riderDuty, riderRoute, setRiderDuty } from '@/lib/server/riders';

// The signed-in rider's own availability. There is no rider id in the request, so a rider can only
// sign themselves in or out.
export const GET = riderRoute(async (request, account) => Response.json(riderDuty(account.riderId)));

export const POST = riderRoute(async (request, account) => {
  const { online } = await request.json();
  return Response.json(setRiderDuty(account, online === true));
});
