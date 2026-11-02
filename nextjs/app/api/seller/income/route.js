import { sellerFrom } from '@/lib/server/auth';
import { incomeOverview } from '@/lib/server/sellerIncome';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json(incomeOverview(sellerFrom(request))));
