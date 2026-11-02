import { adminRoute } from '@/lib/server/admin';
import { listApplications } from '@/lib/server/applications';

export const GET = adminRoute('sellers', async (request) => listApplications(request.nextUrl.searchParams));
