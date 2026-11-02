import { ADMIN_ROLES } from '@/lib/adminRoles';
import { adminRoute } from '@/lib/server/admin';
import { listAdminNotifications, markAdminNotificationsRead } from '@/lib/server/notifications';

// Every administrator gets the notices their role's permissions cover.
export const GET = adminRoute(null, async (request, admin) => Response.json({ notifications: listAdminNotifications(admin.username, ADMIN_ROLES[admin.adminRole]?.permissions || []) }));

export const POST = adminRoute(null, async (request, admin) => {
  markAdminNotificationsRead(admin.username);
  return new Response(null, { status: 204 });
});
