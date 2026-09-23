import plMessages from '@/messages/pl.json';
import { createManifest } from '@/lib/pwa/manifest';

/** Stary URL pozostaje dostępny dla instalacji wykonanych przed zmianą. */
export function GET(): Response {
  return Response.json(
    createManifest('pl', plMessages.common.appName, plMessages.metadata.homeDescription),
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } },
  );
}
