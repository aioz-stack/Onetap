import { adminRoute } from '@/lib/server/admin';
import { sellerFeeList } from '@/lib/server/fees';

export const GET = adminRoute('fees', async (request) => sellerFeeList(request.nextUrl.searchParams));
