import { changeRiderPassword, riderRoute } from '@/lib/server/riders';

export const POST = riderRoute(async (request, account) => {
  const { current, next } = await request.json();
  await changeRiderPassword(account, current, next);
  return new Response(null, { status: 204 });
});
