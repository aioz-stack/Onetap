import { courierPartner, courierRoute, savePartnerHub } from '@/lib/server/courierPanel';

// The partner's Company Profile. The partner is always the signed-in user's own.
export const GET = courierRoute(async (request, account) => Response.json({ partner: courierPartner(account.partnerId) }));

export const POST = courierRoute(async (request, account) => Response.json({ partner: savePartnerHub(account, await request.json()) }));
