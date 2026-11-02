import { courierPartner, courierRoute } from '@/lib/server/courierPanel';

export const GET = courierRoute(async (request, account) => Response.json({ partner: courierPartner(account.partnerId) }));
