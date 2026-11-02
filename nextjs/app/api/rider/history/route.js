import { riderHistory, riderRoute } from '@/lib/server/riders';

export const GET = riderRoute(async (request, account) => Response.json(riderHistory(account, new URL(request.url).searchParams)));
