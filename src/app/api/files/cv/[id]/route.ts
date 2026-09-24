import { emptyDownloadResponse, openCvDownload } from '@/lib/files/candidate-cv';
import { getCvServiceDeps, readCandidateSession } from '@/lib/files/runtime';
import { AppError } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Pobranie własnego CV (#26, Invariant #10). Link wystawia akcja `prepareCvDownload`
 * (podpis HMAC, 60 s, związany z plikiem i użytkownikiem). Trasa ponownie sprawdza bieżącą
 * sesję, podpis, własność i stan skanu, a bajty strumieniuje z prywatnego bucketu — bez
 * przekierowania na adres S3. Każda odmowa = 404 bez treści (bez enumeracji plików).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const token = new URL(request.url).searchParams.get('t') ?? '';
  try {
    const deps = await getCvServiceDeps();
    if (!deps) return emptyDownloadResponse(404);
    const session = await readCandidateSession(deps.pool, request.headers);
    if (session.status !== 'candidate') return emptyDownloadResponse(404);
    return await openCvDownload(deps, session.id, id, token, request.signal);
  } catch {
    captureError(new AppError('INTERNAL'), { area: 'files.download' });
    return emptyDownloadResponse(503);
  }
}
