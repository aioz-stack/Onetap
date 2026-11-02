import { adminRoute } from '@/lib/server/admin';
import { listAudit } from '@/lib/server/overview';

export const GET = adminRoute('audit', async (request) => listAudit(request.nextUrl.searchParams));
