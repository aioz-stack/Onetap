import { customerAccountFrom } from '@/lib/server/auth';
import { validIdResponse } from '@/lib/server/customerApprovals';
import { route } from '@/lib/server/route';

// The signed-in customer's own valid ID photo. Nobody else's can be asked for here.
export const GET = route(async (request) => validIdResponse(customerAccountFrom(request).username));
