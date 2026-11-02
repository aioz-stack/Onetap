import { adminRoute } from '@/lib/server/admin';
import { listShipments } from '@/lib/server/shipments';

export const GET = adminRoute('shipments', async (request) => listShipments(request.nextUrl.searchParams));
