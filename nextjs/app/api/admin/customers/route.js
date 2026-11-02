import { adminRoute } from '@/lib/server/admin';
import { listCustomerApprovals } from '@/lib/server/customerApprovals';

export const GET = adminRoute('customers', async (request) => listCustomerApprovals(request.nextUrl.searchParams));
