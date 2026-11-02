import { riderCollections } from '@/lib/server/riderCash';
import { riderRoute } from '@/lib/server/riders';

export const GET = riderRoute(async (request, account) => Response.json(riderCollections(account, request.nextUrl.searchParams)));
