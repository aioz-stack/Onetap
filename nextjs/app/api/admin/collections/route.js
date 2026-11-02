import { adminRoute } from '@/lib/server/admin';
import { collectionsReport, listCollections } from '@/lib/server/collections';

export const GET = adminRoute('cod', async (request) => {
  const params = request.nextUrl.searchParams;
  return params.get('period') ? collectionsReport(params) : listCollections(params);
});

