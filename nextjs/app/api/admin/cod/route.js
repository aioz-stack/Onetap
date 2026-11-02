import { adminRoute } from '@/lib/server/admin';
import { listCod } from '@/lib/server/cod';

export const GET = adminRoute('cod', async (request) => listCod(request.nextUrl.searchParams));
