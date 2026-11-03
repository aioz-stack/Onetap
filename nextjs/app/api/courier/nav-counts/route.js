import { courierRoute } from '@/lib/server/courierPanel';
import { courierNavCounts } from '@/lib/server/navCounts';

export const GET = courierRoute(async (request, account) => Response.json({ counts: courierNavCounts(account.partnerId) }));
