import { sellerFrom } from '@/lib/server/auth';
import { incomeStatement } from '@/lib/server/sellerIncome';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => incomeStatement(sellerFrom(request), request.nextUrl.searchParams));
