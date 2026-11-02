import { sellerFrom } from '@/lib/server/auth';
import { listPickups } from '@/lib/server/pickups';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => listPickups(request.nextUrl.searchParams, { seller: sellerFrom(request) }));
