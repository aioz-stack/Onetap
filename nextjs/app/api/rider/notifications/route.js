import { listRiderNotifications, markRiderNotificationsRead } from '@/lib/server/notifications';
import { riderRoute } from '@/lib/server/riders';

export const GET = riderRoute(async (request, account) => Response.json({ notifications: listRiderNotifications(account.riderId) }));

// `{ id }` marks one notice read. An empty body marks them all.
export const POST = riderRoute(async (request, account) => {
  const body = await request.json().catch(() => ({}));
  markRiderNotificationsRead(account.riderId, body?.id);
  return new Response(null, { status: 204 });
});
