import { adminRoute } from '@/lib/server/admin';
import { listPayouts } from '@/lib/server/sellerIncome';

export const GET = adminRoute('cod', async (request) => listPayouts(request.nextUrl.searchParams));
