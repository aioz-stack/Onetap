import { riderHome, riderRoute } from '@/lib/server/riders';

export const GET = riderRoute(async (request, account) => Response.json(riderHome(account)));
