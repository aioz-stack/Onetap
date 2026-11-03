import { route } from '@/lib/server/route';
import { streetsFor } from '@/lib/server/streets';

export const dynamic = 'force-dynamic';

// Public: the sign-up forms need it before there is an account.
export const GET = route(async (request) => Response.json({ streets: streetsFor(request.nextUrl.searchParams.get('barangay') || '') }));
