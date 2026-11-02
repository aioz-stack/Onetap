import { courierRoute } from '@/lib/server/courierPanel';
import { listCourierNotifications, markCourierNotificationsRead } from '@/lib/server/notifications';

export const GET = courierRoute(async (request, account) => Response.json({ notifications: listCourierNotifications(account.partnerId) }));

export const POST = courierRoute(async (request, account) => {
  markCourierNotificationsRead(account.partnerId);
  return new Response(null, { status: 204 });
});
