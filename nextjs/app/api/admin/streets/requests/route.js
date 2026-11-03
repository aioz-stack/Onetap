import { adminRoute } from '@/lib/server/admin';
import { listStreetRequests } from '@/lib/server/streets';

export const GET = adminRoute('logistics', async (request) => listStreetRequests(request.nextUrl.searchParams));
