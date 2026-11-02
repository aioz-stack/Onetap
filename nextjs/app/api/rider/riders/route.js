import { riderChoices, riderRoute } from '@/lib/server/riders';

export const GET = riderRoute(async (request, account) => Response.json({ riders: riderChoices(account.partnerId) }));
