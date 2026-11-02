import { adminRoute } from '@/lib/server/admin';
import { listIntegrations } from '@/lib/server/logistics';

export const GET = adminRoute('api', async () => Response.json({ partners: listIntegrations() }));
