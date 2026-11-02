import { courierReports, courierRoute } from '@/lib/server/courierPanel';

export const GET = courierRoute(async (request, account) => Response.json(courierReports(request.nextUrl.searchParams, account.partnerId)));
