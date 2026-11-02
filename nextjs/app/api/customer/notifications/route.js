import { customerAccountFrom } from '@/lib/server/auth';
import { listCustomerNotifications, markCustomerNotificationsRead } from '@/lib/server/notifications';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ notifications: listCustomerNotifications(customerAccountFrom(request).username) }));

export const POST = route(async (request) => {
  markCustomerNotificationsRead(customerAccountFrom(request).username);
  return new Response(null, { status: 204 });
});
