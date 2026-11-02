import { courierRoute } from '@/lib/server/courierPanel';
import { listPartnerRemittances } from '@/lib/server/riderCash';

export const GET = courierRoute(async (request, account) => listPartnerRemittances(request.nextUrl.searchParams, account.partnerId));
