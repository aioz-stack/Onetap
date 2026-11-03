import { adminRoute } from '@/lib/server/admin';
import { adminNavCounts } from '@/lib/server/navCounts';

export const GET = adminRoute(null, async (request, admin) => Response.json({ counts: adminNavCounts(admin) }));
