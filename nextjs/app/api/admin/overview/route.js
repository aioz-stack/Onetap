import { adminRoute } from '@/lib/server/admin';
import { adminOverview } from '@/lib/server/overview';

export const GET = adminRoute(null, async (request, admin) => Response.json(adminOverview(admin)));
