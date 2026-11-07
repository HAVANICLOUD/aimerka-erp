import { env } from 'cloudflare:workers';
import { requestAccess } from '../../../lib/access';
import { createCompetitionHandler } from '../../../lib/competition-pricing.mjs';

export const dynamic = 'force-dynamic';
const handle = createCompetitionHandler({
  access: requestAccess,
  getKey: () => (env as unknown as { SERPAPI_KEY?: string }).SERPAPI_KEY,
});
export async function POST(request: Request) { return handle(request); }
// GET never contacts a provider, including for status checks.
export async function GET(request: Request) { return handle(request); }
