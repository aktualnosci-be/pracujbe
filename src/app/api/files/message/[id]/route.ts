import { emptyAttachmentResponse, openAttachmentDownload } from '@/lib/files/message-attachments';
import { getAttachmentServiceDeps, readSessionUserId } from '@/lib/files/runtime';
import { AppError } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Pobranie załącznika wiadomości (0119, Invariant #10). Link wystawia akcja
 * `prepareMessageAttachmentDownload` (podpis HMAC, 60 s, związany z załącznikiem i
 * użytkownikiem). Trasa ponownie sprawdza bieżącą sesję, podpis, dostęp do rozmowy (baza:
 * członkostwo, blokada firmy) i stan skanu, a bajty strumieniuje z prywatnego bucketu — bez
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
    const deps = await getAttachmentServiceDeps();
    if (!deps) return emptyAttachmentResponse(404);
    const userId = await readSessionUserId(deps.pool, request.headers);
    if (!userId) return emptyAttachmentResponse(404);
    return await openAttachmentDownload(deps, userId, id, token, request.signal);
  } catch {
    captureError(new AppError('INTERNAL'), { area: 'attachments.download' });
    return emptyAttachmentResponse(503);
  }
}
