import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

const MAX_BYTES = 5 * 1024 * 1024;
const UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OBJECT_UUID =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OWNER = new RegExp(`^${UUID}$`);
const KEY = new RegExp(`^${UUID}/cv-${OBJECT_UUID}\\.(pdf|doc|docx)$`);
/** Załącznik rozmowy (0119): prefiks = id rozmowy, nazwa `att-<uuid>` nadana przez serwer. */
const ATTACHMENT_KEY = new RegExp(
  `^${UUID}/att-${OBJECT_UUID}\\.(pdf|doc|docx|jpg|png)$`,
);
const TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  png: "image/png",
} as const;
type CvExtension = "pdf" | "doc" | "docx";
type Extension = keyof typeof TYPES;
export type AttachmentExtension = Extension;
type ContentType = (typeof TYPES)[Extension];
export type StorageErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ACCESS_DENIED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "CANCELLED";
export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageErrorCode; retryable: boolean };
export interface RailwayBucketOptions {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  timeoutMs?: number;
  /** Transport HTTP SDK można zastąpić w testach bez połączenia z bucketem. */
  requestHandler?: S3ClientConfig["requestHandler"];
}

/** ownerId pochodzi z potwierdzonej sesji serwera, nigdy z formularza. */
export function createCandidateCvKey(
  ownerId: string,
  extension: CvExtension,
): string {
  if (
    typeof ownerId !== "string" ||
    !OWNER.test(ownerId) ||
    !["pdf", "doc", "docx"].includes(extension)
  )
    throw new Error("INVALID_INPUT");
  return `${ownerId}/cv-${randomUUID()}.${extension}`;
}

/** conversationId pochodzi z rozmowy, do której dostęp potwierdza baza (stage_message_attachment). */
export function createMessageAttachmentKey(
  conversationId: string,
  extension: Extension,
): string {
  if (
    typeof conversationId !== "string" ||
    !OWNER.test(conversationId) ||
    !Object.prototype.hasOwnProperty.call(TYPES, extension)
  )
    throw new Error("INVALID_INPUT");
  return `${conversationId}/att-${randomUUID()}.${extension}`;
}

function failure(error: StorageErrorCode): StorageResult<never> {
  return {
    ok: false,
    error,
    retryable: error === "UNAVAILABLE" || error === "TIMEOUT",
  };
}
function validKey(key: string): boolean {
  return typeof key === "string" && (KEY.test(key) || ATTACHMENT_KEY.test(key));
}
function contentType(key: string): ContentType {
  return TYPES[key.slice(key.lastIndexOf(".") + 1) as Extension];
}
function classify(error: unknown): StorageErrorCode {
  const value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  const status = value?.$metadata?.httpStatusCode;
  if (status === 401 || status === 403) return "ACCESS_DENIED";
  // Brak bucketa jest awarią konfiguracji, nie idempotentnym usunięciem klucza.
  if (value?.name === "NoSuchBucket") return "UNAVAILABLE";
  if (status === 404 || value?.name === "NoSuchKey") return "NOT_FOUND";
  if (status === 409 || status === 412) return "CONFLICT";
  if (value?.name === "TimeoutError" || value?.name === "RequestTimeout")
    return "TIMEOUT";
  return "UNAVAILABLE";
}
function configured(options: RailwayBucketOptions): boolean {
  try {
    const endpoint = new URL(options.endpoint);
    return (
      endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.hash &&
      !endpoint.search &&
      endpoint.pathname === "/" &&
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket) &&
      !options.bucket.includes("..") &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(options.bucket) &&
      /^[a-z0-9][a-z0-9-]{0,62}$/.test(options.region) &&
      typeof options.accessKeyId === "string" &&
      Boolean(options.accessKeyId.trim()) &&
      typeof options.secretAccessKey === "string" &&
      Boolean(options.secretAccessKey.trim()) &&
      (options.forcePathStyle === undefined ||
        typeof options.forcePathStyle === "boolean") &&
      (options.timeoutMs === undefined ||
        (Number.isSafeInteger(options.timeoutMs) &&
          options.timeoutMs > 0 &&
          options.timeoutMs <= 2_147_483_647))
    );
  } catch {
    return false;
  }
}

/** Tylko transport CV i załączników rozmów. Sesja, RLS, scan_status i zgodność z metadanymi wymagają kontroli przez wywołującego. */
export function createRailwayBucket(options: RailwayBucketOptions) {
  const bucket = options.bucket;
  const client = configured(options)
    ? new S3Client({
        endpoint: options.endpoint,
        region: options.region,
        forcePathStyle: options.forcePathStyle ?? false,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
        maxAttempts: 1,
        requestHandler: options.requestHandler,
      })
    : undefined;
  function lifecycle(signal?: AbortSignal) {
    const controller = new AbortController();
    let reason: "TIMEOUT" | "CANCELLED" | undefined;
    const abort = (code: "TIMEOUT" | "CANCELLED" = "CANCELLED") => {
      if (controller.signal.aborted) return;
      reason = code;
      controller.abort();
    };
    const cancel = () => abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(
      () => abort("TIMEOUT"),
      options.timeoutMs ?? 30_000,
    );
    return {
      signal: controller.signal,
      abort,
      code: (error: unknown): StorageErrorCode => reason ?? classify(error),
      cleanup: () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      },
    };
  }
  return {
    async put(input: {
      key: string;
      bytes: Uint8Array;
      contentType: ContentType;
      signal?: AbortSignal;
    }): Promise<
      StorageResult<{ key: string; sizeBytes: number; sha256: string }>
    > {
      if (!client) return failure("NOT_CONFIGURED");
      if (
        !validKey(input.key) ||
        !(input.bytes instanceof Uint8Array) ||
        input.bytes.byteLength < 1 ||
        input.bytes.byteLength > MAX_BYTES ||
        contentType(input.key) !== input.contentType
      )
        return failure("INVALID_INPUT");
      const life = lifecycle(input.signal);
      try {
        if (life.signal.aborted) return failure("CANCELLED");
        // Kopia chroni wynikowy hash i przesyłane body przed zmianą bufora przez wywołującego.
        const bytes = Uint8Array.from(input.bytes);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: input.key,
            Body: bytes,
            ContentLength: bytes.byteLength,
            ContentType: input.contentType,
            IfNoneMatch: "*",
          }),
          { abortSignal: life.signal },
        );
        if (life.signal.aborted) return failure(life.code(null));
        return {
          ok: true,
          value: { key: input.key, sizeBytes: bytes.byteLength, sha256 },
        };
      } catch (error) {
        return failure(life.code(error));
      } finally {
        life.cleanup();
      }
    },
    async delete(input: {
      key: string;
      signal?: AbortSignal;
    }): Promise<StorageResult<{ deleted: true }>> {
      if (!client) return failure("NOT_CONFIGURED");
      if (!validKey(input.key)) return failure("INVALID_INPUT");
      const life = lifecycle(input.signal);
      try {
        if (life.signal.aborted) return failure("CANCELLED");
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: input.key }),
          { abortSignal: life.signal },
        );
        return life.signal.aborted
          ? failure(life.code(null))
          : { ok: true, value: { deleted: true } };
      } catch (error) {
        const code = life.code(error);
        return code === "NOT_FOUND"
          ? { ok: true, value: { deleted: true } }
          : failure(code);
      } finally {
        life.cleanup();
      }
    },
    async openStream(input: { key: string; signal?: AbortSignal }): Promise<
      StorageResult<{
        body: ReadableStream<Uint8Array>;
        contentLength: number;
        contentType: string;
        close(): Promise<void>;
      }>
    > {
      if (!client) return failure("NOT_CONFIGURED");
      if (!validKey(input.key)) return failure("INVALID_INPUT");
      const life = lifecycle(input.signal);
      let source: GetObjectCommandOutput["Body"];
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let streamController:
        ReadableStreamDefaultController<Uint8Array> | undefined;
      let finished = false;
      let closing: Promise<void> | undefined;
      const close = (code: StorageErrorCode = "CANCELLED"): Promise<void> => {
        if (finished) return closing ?? Promise.resolve();
        finished = true;
        life.cleanup();
        life.abort();
        try {
          streamController?.error(new Error(code));
        } catch {
          /* Odpowiedź może być już zamknięta. */
        }
        closing = (async () => {
          try {
            if (reader) {
              await reader.cancel();
              reader.releaseLock();
            } else if (source && "destroy" in source) source.destroy();
          } catch {
            /* Błąd dostawcy nie opuszcza adaptera. */
          }
        })();
        return closing;
      };
      try {
        if (life.signal.aborted) {
          life.cleanup();
          return failure("CANCELLED");
        }
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: input.key }),
          { abortSignal: life.signal },
        );
        source = result.Body;
        reader = source?.transformToWebStream().getReader();
        const length = result.ContentLength;
        const type = result.ContentType;
        if (
          !reader ||
          typeof length !== "number" ||
          !Number.isSafeInteger(length) ||
          length < 1 ||
          length > MAX_BYTES ||
          type !== contentType(input.key)
        ) {
          await close();
          return failure("UNAVAILABLE");
        }
        if (life.signal.aborted) {
          const code = life.code(null);
          await close();
          return failure(code);
        }
        let received = 0;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            life.signal.addEventListener(
              "abort",
              () => {
                void close(life.code(null));
              },
              { once: true },
            );
          },
          async pull(controller) {
            try {
              const chunk = await reader!.read();
              if (finished) return;
              if (chunk.done) {
                if (received !== length) {
                  await close("UNAVAILABLE");
                  return;
                }
                finished = true;
                life.cleanup();
                reader!.releaseLock();
                controller.close();
                return;
              }
              if (
                !(chunk.value instanceof Uint8Array) ||
                chunk.value.byteLength > length - received
              ) {
                await close("UNAVAILABLE");
                return;
              }
              received += chunk.value.byteLength;
              controller.enqueue(chunk.value);
            } catch {
              await close(life.code(null));
            }
          },
          cancel: () => close(),
        });
        return {
          ok: true,
          value: {
            body,
            contentLength: length,
            contentType: type!,
            close: () => close(),
          },
        };
      } catch (error) {
        const code = life.code(error);
        await close();
        return failure(code);
      }
    },
  };
}
