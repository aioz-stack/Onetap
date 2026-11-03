import { adminRoute } from '@/lib/server/admin';
import { partnerFeeList } from '@/lib/server/fees';

export const GET = adminRoute('fees', async (request) => partnerFeeList(request.nextUrl.searchParams));
