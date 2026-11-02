import { courierRoute } from '@/lib/server/courierPanel';
import { riderChoices } from '@/lib/server/riders';

export const GET = courierRoute(async (request, account) => Response.json({ riders: riderChoices(account.partnerId) }));
