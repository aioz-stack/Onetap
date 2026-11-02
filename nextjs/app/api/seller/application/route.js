import { applicationFor, resubmitApplication } from '@/lib/server/applications';
import { applicantFrom } from '@/lib/server/auth';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ application: applicationFor(applicantFrom(request)) }));

export const POST = route(async (request) => Response.json({ application: await resubmitApplication(applicantFrom(request), request) }));
