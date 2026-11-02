import { courierRoute, listCourierCod } from '@/lib/server/courierPanel';

export const GET = courierRoute(async (request, account) => listCourierCod(request.nextUrl.searchParams, account.partnerId));
