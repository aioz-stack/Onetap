import { adminRoute } from '@/lib/server/admin';
import { validIdResponse } from '@/lib/server/customerApprovals';

// The customer's valid ID photo. It is a private file, so it only goes to administrators who review customers.
export const GET = adminRoute('customers', async (request, admin, { params }) => {
  const { username } = await params;
  return validIdResponse(username);
});
