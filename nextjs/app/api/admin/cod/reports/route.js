import { adminRoute } from '@/lib/server/admin';
import { codReport } from '@/lib/server/cod';

export const GET = adminRoute('cod', async (request) => {
  const params = request.nextUrl.searchParams;
  return codReport(params.get('period'), params.get('format'));
});
