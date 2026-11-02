import { logisticsOptions } from '@/lib/server/logistics';
import { route } from '@/lib/server/route';

export const dynamic = 'force-dynamic';

export const GET = route(async () => Response.json({ partners: logisticsOptions() }));
