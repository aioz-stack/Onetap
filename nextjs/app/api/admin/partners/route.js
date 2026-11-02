import { adminRoute } from '@/lib/server/admin';
import { addPartner, listPartners } from '@/lib/server/logistics';

export const GET = adminRoute('logistics', async () => Response.json({ partners: listPartners() }));

export const POST = adminRoute('logistics', async (request, admin) => Response.json({ partner: await addPartner(admin, await request.json()) }, { status: 201 }));
