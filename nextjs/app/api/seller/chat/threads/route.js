import { sellerFrom } from '@/lib/server/auth';
import { listThreads } from '@/lib/server/chat';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ threads: listThreads('seller', sellerFrom(request)) }));
