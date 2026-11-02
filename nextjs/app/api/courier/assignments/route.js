import { courierRoute } from '@/lib/server/courierPanel';
import { listAssignments } from '@/lib/server/riders';

export const GET = courierRoute(async (request, account) => listAssignments(request.nextUrl.searchParams, account.partnerId));
