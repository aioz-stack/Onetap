import { registerCustomer } from '@/lib/server/customerApprovals';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => Response.json({ account: await registerCustomer(request) }, { status: 201 }));
