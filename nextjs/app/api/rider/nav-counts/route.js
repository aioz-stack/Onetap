import { riderNavCounts } from '@/lib/server/navCounts';
import { riderRoute } from '@/lib/server/riders';

export const GET = riderRoute(async (request, account) => Response.json({ counts: riderNavCounts(account.riderId) }));
