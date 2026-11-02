import { courierRoute } from '@/lib/server/courierPanel';
import { listShipments } from '@/lib/server/shipments';

export const GET = courierRoute(async (request, account) => listShipments(request.nextUrl.searchParams, account.partnerId));
