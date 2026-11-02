import { adminRoute } from '@/lib/server/admin';
import { listRemittances, recordRemittance } from '@/lib/server/cod';

export const GET = adminRoute('cod', async (request) => Response.json(listRemittances(request.nextUrl.searchParams)));

export const POST = adminRoute('cod', async (request, admin) => Response.json(recordRemittance(admin, await request.json()), { status: 201 }));
