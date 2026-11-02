import { adminRoute } from '@/lib/server/admin';
import { listListings } from '@/lib/server/moderation';

export const GET = adminRoute('products', async (request) => listListings(request.nextUrl.searchParams));
