import { courierRoute } from '@/lib/server/courierPanel';
import { createRider, listRiders } from '@/lib/server/riders';

export const GET = courierRoute(async (request, account) => listRiders(request.nextUrl.searchParams, account.partnerId));

export const POST = courierRoute(async (request, account) => Response.json({ rider: await createRider(account, await request.formData()) }, { status: 201 }));
