import { courierRoute } from '@/lib/server/courierPanel';
import { riderPerformance } from '@/lib/server/riders';

export const GET = courierRoute(async (request, account) => riderPerformance(request.nextUrl.searchParams, account.partnerId));
