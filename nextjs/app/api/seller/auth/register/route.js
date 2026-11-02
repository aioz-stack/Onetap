import { registerSeller } from '@/lib/server/applications';
import { route } from '@/lib/server/route';

export const POST = route(async (request) => Response.json({ account: await registerSeller(request) }, { status: 201 }));
