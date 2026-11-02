import { adminRoute } from '@/lib/server/admin';
import { listAccounts } from '@/lib/server/payoutAccounts';

export const GET = adminRoute('cod', async (request) => listAccounts(request.nextUrl.searchParams));
