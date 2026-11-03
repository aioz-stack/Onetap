import { adminRoute } from '@/lib/server/admin';
import { adminStreets, changeStreet } from '@/lib/server/streets';

export const GET = adminRoute('logistics', async (request) => Response.json({ streets: adminStreets(request.nextUrl.searchParams.get('barangay') || '') }));

export const POST = adminRoute('logistics', async (request, admin) => Response.json({ streets: changeStreet(admin, await request.json()) }));
