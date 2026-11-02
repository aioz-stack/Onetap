import { courierOverview, courierRoute } from '@/lib/server/courierPanel';

export const GET = courierRoute(async (request, account) => Response.json(courierOverview(account.partnerId)));
