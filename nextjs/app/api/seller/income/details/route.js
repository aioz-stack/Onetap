import { sellerFrom } from '@/lib/server/auth';
import { incomeDetails } from '@/lib/server/sellerIncome';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => incomeDetails(sellerFrom(request), request.nextUrl.searchParams));
