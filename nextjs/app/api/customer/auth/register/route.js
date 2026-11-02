import { registerAccount } from '@/lib/server/auth';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => Response.json({ account: await registerAccount('customer', request, await request.json()) }, { status: 201 }));
