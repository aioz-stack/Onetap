import { courierLogisticsRemittances, courierRoute } from '@/lib/server/courierPanel';

export const GET = courierRoute(async (request, account) => courierLogisticsRemittances(request.nextUrl.searchParams, account.partnerId));
