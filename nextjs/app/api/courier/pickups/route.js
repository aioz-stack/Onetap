import { courierRoute } from '@/lib/server/courierPanel';
import { listPickups } from '@/lib/server/pickups';

export const GET = courierRoute(async (request, account) => listPickups(request.nextUrl.searchParams, { partnerId: account.partnerId }));
