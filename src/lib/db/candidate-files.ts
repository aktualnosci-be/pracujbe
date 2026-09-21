import "server-only";

import { z } from "zod/v3";
import { AppError } from "../errors";
import {
  withUserTransaction,
  type TransactionPool,
  type TransactionQuery,
} from "./transaction";

const MAX_BYTES = 5 * 1024 * 1024;
const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CV_KEY = new RegExp(
  `^${UUID}/cv-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(pdf|doc|docx)$`,
);
const TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
const fileName = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value));
const metadataSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  bucket: z.literal("candidate-files"),
  key: z.string().regex(CV_KEY),
  fileName,
  mimeType: z.enum([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  sizeBytes: z.number().int().min(1).max(MAX_BYTES),
  scanStatus: z.enum(["pending", "clean", "skipped", "infected"]),
  checksumSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
});
export type CandidateCvMetadata = z.infer<typeof metadataSchema>;
export interface CandidateFileListItem {
  id: string;
  fileName: string;
  downloadable: boolean;
}
const createSchema = metadataSchema
  .pick({ key: true, fileName: true, mimeType: true, sizeBytes: true })
  .extend({
    scanStatus: z.enum(["pending", "skipped"]),
    checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type CreateCandidateCvInput = z.infer<typeof createSchema>;

const COLUMNS = `id, owner_id AS "ownerId", bucket, path AS key,
  file_name AS "fileName", mime_type AS "mimeType", size_bytes::integer AS "sizeBytes",
  scan_status AS "scanStatus", checksum_sha256 AS "checksumSha256"`;
const OWN_CV = `owner_id = auth.uid() AND entity_type = 'candidate_cv'
  AND bucket = 'candidate-files' AND deleted_at IS NULL`;

function readMetadata(value: unknown): CandidateCvMetadata {
  const parsed = metadataSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.key.split("/")[0] !== parsed.data.ownerId ||
    TYPES[parsed.data.key.split(".").at(-1) as keyof typeof TYPES] !==
      parsed.data.mimeType
  ) {
    throw new AppError("INTERNAL");
  }
  return parsed.data;
}
function validatedId(fileId: string): string {
  const result = z.string().uuid().safeParse(fileId);
  if (!result.success) throw new AppError("VALIDATION_FAILED");
  return result.data;
}

/** trustedUserId wyłącznie z potwierdzonej sesji. Żadnych połączeń ani tożsamości globalnych. */
async function withCandidate<T>(
  pool: TransactionPool,
  trustedUserId: string | null,
  action: (transaction: TransactionQuery) => Promise<T>,
): Promise<T> {
  if (
    trustedUserId === null ||
    !z.string().uuid().safeParse(trustedUserId).success
  ) {
    throw new AppError("PERMISSION_DENIED");
  }
  try {
    return await withUserTransaction(
      pool,
      trustedUserId,
      async (transaction) => {
        // Krótka blokada chroni kontrolę roli/stanu przed równoległą dezaktywacją.
        // Operacje S3 zawsze następują poza tą transakcją.
        const profile = (await transaction.query(`SELECT id FROM public.profiles
        WHERE id = auth.uid() AND role = 'candidate' AND is_active = true AND deleted_at IS NULL
        FOR SHARE`)) as { rows: { id: string }[] };
        if (!profile.rows[0]) throw new AppError("PERMISSION_DENIED");
        return action(transaction);
      },
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Komunikat/cause pg może zawierać nazwę CV, parametry SQL lub adres serwera.
    throw new AppError("INTERNAL");
  }
}

/** Lista nie wystawia URL ani klucza obiektu; błąd nie udaje pustego zeszytu plików. */
export async function listOwnCandidateFiles(
  pool: TransactionPool,
  trustedUserId: string | null,
): Promise<CandidateFileListItem[]> {
  return withCandidate(pool, trustedUserId, async (transaction) => {
    const result = (await transaction.query(`SELECT ${COLUMNS} FROM public.files
      WHERE ${OWN_CV} ORDER BY created_at DESC, id DESC`)) as {
      rows: unknown[];
    };
    return result.rows.map((value) => {
      const file = readMetadata(value);
      return {
        id: file.id,
        fileName: file.fileName,
        downloadable:
          file.scanStatus === "clean" || file.scanStatus === "skipped",
      };
    });
  });
}

export async function getOwnDownloadableCv(
  pool: TransactionPool,
  trustedUserId: string | null,
  fileId: string,
): Promise<CandidateCvMetadata | null> {
  const id = validatedId(fileId);
  return withCandidate(pool, trustedUserId, async (transaction) => {
    const result = (await transaction.query(
      `SELECT ${COLUMNS} FROM public.files
      WHERE id = $1::uuid AND ${OWN_CV} AND scan_status IN ('clean', 'skipped')`,
      [id],
    )) as { rows: unknown[] };
    return result.rows[0] ? readMetadata(result.rows[0]) : null;
  });
}

/** scanStatus='skipped' wymaga ukończonej walidacji treści w usłudze uploadu; nie oznacza skanu AV. */
export async function createOwnCandidateCv(
  pool: TransactionPool,
  trustedUserId: string | null,
  input: CreateCandidateCvInput,
): Promise<CandidateCvMetadata> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED");
  if (
    (trustedUserId !== null &&
      parsed.data.key.split("/")[0] !== trustedUserId.toLowerCase()) ||
    TYPES[parsed.data.key.split(".").at(-1) as keyof typeof TYPES] !==
      parsed.data.mimeType
  ) {
    throw new AppError("VALIDATION_FAILED");
  }
  return withCandidate(pool, trustedUserId, async (transaction) => {
    const file = parsed.data;
    const result = (await transaction.query(
      `INSERT INTO public.files
      (owner_id, bucket, path, file_name, mime_type, size_bytes, entity_type, visibility, scan_status, checksum_sha256)
      VALUES (auth.uid(), 'candidate-files', $1, $2, $3, $4, 'candidate_cv', 'private', $5, $6)
      RETURNING ${COLUMNS}`,
      [
        file.key,
        file.fileName,
        file.mimeType,
        file.sizeBytes,
        file.scanStatus,
        file.checksumSha256,
      ],
    )) as { rows: unknown[] };
    return readMetadata(result.rows[0]);
  });
}

/** Dopiero zwrócony po COMMIT rekord upoważnia wywołującego do usunięcia obiektu S3. */
export async function deleteOwnCandidateCv(
  pool: TransactionPool,
  trustedUserId: string | null,
  fileId: string,
): Promise<CandidateCvMetadata | null> {
  const id = validatedId(fileId);
  return withCandidate(pool, trustedUserId, async (transaction) => {
    const result = (await transaction.query(
      `DELETE FROM public.files
      WHERE id = $1::uuid AND ${OWN_CV} RETURNING ${COLUMNS}`,
      [id],
    )) as { rows: unknown[] };
    return result.rows[0] ? readMetadata(result.rows[0]) : null;
  });
}
