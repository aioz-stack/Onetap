import { adminRoute } from '@/lib/server/admin';
import { listProviders, saveProvider } from '@/lib/server/payoutAccounts';

export const GET = adminRoute('cod', async () => Response.json({ providers: listProviders({ all: true }) }));

export const POST = adminRoute('cod', async (request, admin) => Response.json({ provider: saveProvider(admin, null, await request.json()) }, { status: 201 }));
