import { applicantFrom } from '@/lib/server/auth';
import { listNotifications, markNotificationsRead } from '@/lib/server/notifications';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ notifications: listNotifications(applicantFrom(request)) }));

export const POST = route(async (request) => {
  markNotificationsRead(applicantFrom(request));
  return new Response(null, { status: 204 });
});
