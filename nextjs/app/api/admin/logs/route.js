import { adminRoute } from '@/lib/server/admin';
import { listApiLogs } from '@/lib/server/overview';

export const GET = adminRoute('api', async (request) => listApiLogs(request.nextUrl.searchParams));
