import { riderRemittances, submitRiderRemittance } from '@/lib/server/riderCash';
import { riderRoute } from '@/lib/server/riders';

export const GET = riderRoute(async (request, account) => Response.json(riderRemittances(account)));

export const POST = riderRoute(async (request, account) => Response.json(submitRiderRemittance(account, await request.json()), { status: 201 }));
