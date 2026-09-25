// @vitest-environment node
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCandidateCvKey,
  createMessageAttachmentKey,
  createRailwayBucket,
  type RailwayBucketOptions,
} from "@/lib/storage/railway-bucket";

const owner = "11111111-1111-4111-8111-111111111111";
const key = `${owner}/cv-22222222-2222-4222-8222-222222222222.pdf`;
const config = {
  endpoint: "https://storage.example.com",
  bucket: "private-cvs",
  region: "auto",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};
const upload = {
  key,
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "application/pdf" as const,
};
interface Request {
  method: string;
  hostname: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}
function response(
  statusCode = 200,
  body = Readable.from([]),
  headers: Record<string, string> = {},
) {
  return { response: { statusCode, body, headers } };
}
function download(
  body = Readable.from([Buffer.from(upload.bytes)]),
  length: string | undefined = "3",
  type = "application/pdf",
) {
  return response(200, body, {
    ...(length === undefined ? {} : { "content-length": length }),
    "content-type": type,
  });
}
function providerError(status: number, code: string) {
  return response(
    status,
    Readable.from([
      `<Error><Code>${code}</Code><Message>test-secret-key Jan Kowalski https://private.example/cv</Message></Error>`,
    ]),
    { "content-type": "application/xml" },
  );
}
function fixture(options: Partial<RailwayBucketOptions> = {}) {
  const handle = vi.fn(
    async (_request: Request, _options?: { abortSignal?: AbortSignal }) =>
      response(),
  );
  return {
    handle,
    store: createRailwayBucket({
      ...config,
      ...options,
      requestHandler: { handle },
    }),
  };
}
async function requireStream(
  store: ReturnType<typeof createRailwayBucket>,
  signal?: AbortSignal,
) {
  const result = await store.openStream({ key, signal });
  if (!result.ok) throw new Error(`Brak strumienia: ${result.error}`);
  return result.value;
}
afterEach(() => vi.useRealTimers());

describe("Prywatny adapter Railway Bucket przez rzeczywisty SDK S3", () => {
  it("załączniki rozmów (0113): klucz `<rozmowa>/att-<uuid>` z JPG/PNG; CV nadal bez obrazów", async () => {
    const { store, handle } = fixture();
    const png = createMessageAttachmentKey(owner, "png");
    expect(png).toMatch(
      new RegExp(`^${owner}/att-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.png$`),
    );
    expect((await store.put({ key: png, bytes: new Uint8Array([1]), contentType: "image/png" })).ok).toBe(true);
    expect((await store.delete({ key: png })).ok).toBe(true);
    expect(handle).toHaveBeenCalledTimes(2);
    // Kontrole ujemne: MIME ≠ rozszerzenie, obraz jako CV, obcy prefiks nazwy i rozszerzenie.
    handle.mockClear();
    for (const invalid of [
      { key: png, contentType: "image/jpeg" as const },
      { key: key.replace(".pdf", ".png"), contentType: "image/png" as const },
      { key: png.replace("/att-", "/img-"), contentType: "image/png" as const },
      { key: png.replace(".png", ".gif"), contentType: "image/png" as const },
    ]) {
      expect(await store.put({ ...invalid, bytes: new Uint8Array([1]) })).toMatchObject({ error: "INVALID_INPUT" });
    }
    expect(handle).not.toHaveBeenCalled();
    expect(() => createMessageAttachmentKey("../x", "png")).toThrow("INVALID_INPUT");
    expect(() => createCandidateCvKey(owner, "png" as "pdf")).toThrow("INVALID_INPUT");
  });

  it("tworzy unikalne klucze UUIDv4 bez nazwy pliku i przyjmuje je przy zapisie", async () => {
    const { store, handle } = fixture();
    const keys = new Set(
      Array.from({ length: 10 }, () => createCandidateCvKey(owner, "pdf")),
    );
    expect(keys.size).toBe(10);
    for (const generated of keys) {
      expect(generated).toMatch(
        new RegExp(
          `^${owner}/cv-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.pdf$`,
        ),
      );
      expect((await store.put({ ...upload, key: generated })).ok).toBe(true);
    }
    expect(handle).toHaveBeenCalledTimes(10);
    expect(() => createCandidateCvKey("../private", "pdf")).toThrow(
      "INVALID_INPUT",
    );
    expect(() => createCandidateCvKey(owner, "exe" as "pdf")).toThrow(
      "INVALID_INPUT",
    );
  });

  it.each([
    "http://storage.example.com",
    "https://name:secret@storage.example.com",
    "https://storage.example.com/#secret",
    "https://storage.example.com/?secret=1",
    "https://storage.example.com/path",
    "",
  ])("odrzuca endpoint %s przed transportem", async (endpoint) => {
    const { store, handle } = fixture({ endpoint });
    expect(await store.put(upload)).toEqual({
      ok: false,
      error: "NOT_CONFIGURED",
      retryable: false,
    });
    expect(await store.openStream({ key })).toMatchObject({
      error: "NOT_CONFIGURED",
    });
    expect(await store.delete({ key })).toMatchObject({
      error: "NOT_CONFIGURED",
    });
    expect(handle).not.toHaveBeenCalled();
  });
  it.each([
    { bucket: "" },
    { bucket: "bucket/other" },
    { bucket: "a..b" },
    { bucket: "127.0.0.1" },
    { region: "" },
    { accessKeyId: " " },
    { secretAccessKey: "" },
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 0.5 },
    { timeoutMs: 2_147_483_648 },
  ])("odmawia przy brakującej lub błędnej konfiguracji %j", async (options) => {
    const { store, handle } = fixture(options);
    expect(await store.put(upload)).toMatchObject({ error: "NOT_CONFIGURED" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("podpisuje prywatny PUT i przesyła zamrożoną kopię bajtów z warunkiem braku nadpisania", async () => {
    const { store, handle } = fixture();
    const bytes = new Uint8Array(upload.bytes);
    const operation = store.put({ ...upload, bytes });
    bytes[0] = 255;
    expect(await operation).toEqual({
      ok: true,
      value: {
        key,
        sizeBytes: 3,
        sha256:
          "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      },
    });
    const sent = handle.mock.calls[0]![0];
    expect(sent.method).toBe("PUT");
    expect(sent.hostname).toBe("private-cvs.storage.example.com");
    expect(sent.path).toBe(`/${key}`);
    expect(sent.body).toEqual(upload.bytes);
    expect(sent.headers["content-length"]).toBe("3");
    expect(sent.headers["content-type"]).toBe("application/pdf");
    expect(sent.headers["if-none-match"]).toBe("*");
    expect(sent.headers.authorization).toContain(
      "AWS4-HMAC-SHA256 Credential=test-access-key/",
    );
    expect(sent.headers).not.toHaveProperty("x-amz-acl");
  });
  it("obsługuje jawnie wybrany path-style", async () => {
    const { store, handle } = fixture({ forcePathStyle: true });
    expect((await store.put(upload)).ok).toBe(true);
    expect(handle.mock.calls[0]![0].hostname).toBe("storage.example.com");
    expect(handle.mock.calls[0]![0].path).toBe(`/private-cvs/${key}`);
  });
  it.each([
    "../secret.pdf",
    key.replace("cv-", "invoice-"),
    key.replace(".pdf", ".exe"),
    "https://example.com/a.pdf",
    key.replace("/cv-", "/nested/cv-"),
    key.toUpperCase(),
    key.replace("-4222-", "-7222-"),
    key.replace("-8222-", "-2222-"),
    key.replace(owner, "00000000-0000-0000-0000-000000000000"),
    `${key}\n`,
    key.replace("/", "%2f"),
    `${key}?token=x`,
  ])(
    "odrzuca niekanoniczny klucz %s we wszystkich operacjach",
    async (invalid) => {
      const { store, handle } = fixture();
      expect(await store.put({ ...upload, key: invalid })).toMatchObject({
        error: "INVALID_INPUT",
      });
      expect(await store.openStream({ key: invalid })).toMatchObject({
        error: "INVALID_INPUT",
      });
      expect(await store.delete({ key: invalid })).toMatchObject({
        error: "INVALID_INPUT",
      });
      expect(handle).not.toHaveBeenCalled();
    },
  );
  it("akceptuje dokładnie 5 MiB, ale odrzuca zero, nadmiar i niezgodny MIME", async () => {
    const { store, handle } = fixture();
    const maximum = 5 * 1024 * 1024;
    expect(
      await store.put({ ...upload, bytes: new Uint8Array(maximum) }),
    ).toMatchObject({ ok: true, value: { sizeBytes: maximum } });
    handle.mockClear();
    for (const bytes of [new Uint8Array(), new Uint8Array(maximum + 1)]) {
      expect(await store.put({ ...upload, bytes })).toMatchObject({
        error: "INVALID_INPUT",
      });
    }
    expect(
      await store.put({ ...upload, contentType: "application/msword" }),
    ).toMatchObject({ error: "INVALID_INPUT" });
    expect(handle).not.toHaveBeenCalled();
  });
  it.each([
    ["doc", "application/msword"],
    [
      "docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ] as const)(
    "przesyła także zweryfikowany przez domenę %s",
    async (extension, type) => {
      const { store, handle } = fixture();
      expect(
        (
          await store.put({
            ...upload,
            key: key.replace(".pdf", `.${extension}`),
            contentType: type,
          })
        ).ok,
      ).toBe(true);
      expect(handle.mock.calls[0]![0].headers["content-type"]).toBe(type);
    },
  );
  it.each([
    [401, "AccessDenied", "ACCESS_DENIED", false],
    [403, "AccessDenied", "ACCESS_DENIED", false],
    [404, "NoSuchKey", "NOT_FOUND", false],
    [404, "NoSuchBucket", "UNAVAILABLE", true],
    [409, "ConditionalRequestConflict", "CONFLICT", false],
    [412, "PreconditionFailed", "CONFLICT", false],
    [503, "SlowDown", "UNAVAILABLE", true],
  ] as const)(
    "redaguje rzeczywisty błąd XML SDK %s/%s",
    async (status, code, error, retryable) => {
      const { store, handle } = fixture();
      handle.mockResolvedValue(providerError(status, code));
      expect(await store.openStream({ key })).toEqual({
        ok: false,
        error,
        retryable,
      });
      expect(handle).toHaveBeenCalledOnce();
    },
  );
  it("konflikt PUT nie powoduje niechronionej próby nadpisania", async () => {
    const { store, handle } = fixture();
    handle.mockResolvedValue(providerError(412, "PreconditionFailed"));
    expect(await store.put(upload)).toEqual({
      ok: false,
      error: "CONFLICT",
      retryable: false,
    });
    expect(handle).toHaveBeenCalledOnce();
  });
  it("DELETE jest idempotentny dla klucza, ale nie dla nieistniejącego bucketa lub odmowy", async () => {
    const { store, handle } = fixture();
    handle
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(providerError(404, "NoSuchKey"))
      .mockResolvedValueOnce(providerError(404, "NoSuchBucket"))
      .mockResolvedValueOnce(providerError(403, "AccessDenied"));
    expect(await store.delete({ key })).toEqual({
      ok: true,
      value: { deleted: true },
    });
    expect(await store.delete({ key })).toEqual({
      ok: true,
      value: { deleted: true },
    });
    expect(await store.delete({ key })).toMatchObject({ error: "UNAVAILABLE" });
    expect(await store.delete({ key })).toMatchObject({
      error: "ACCESS_DENIED",
    });
    expect(handle.mock.calls[0]![0].method).toBe("DELETE");
  });
  it("sanityzuje błąd transportu i nie ponawia automatycznie zapisu", async () => {
    const { store, handle } = fixture();
    handle.mockRejectedValue(
      new Error("test-secret-key Jan Kowalski https://private.example"),
    );
    expect(await store.put(upload)).toEqual({
      ok: false,
      error: "UNAVAILABLE",
      retryable: true,
    });
    expect(handle).toHaveBeenCalledOnce();
  });

  it("strumieniuje rzeczywiste body Node przez konwersję SDK do strumienia web", async () => {
    const { store, handle } = fixture();
    handle.mockResolvedValue(download());
    const file = await requireStream(store);
    expect(file.contentLength).toBe(3);
    expect(file.contentType).toBe("application/pdf");
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(
      upload.bytes,
    );
    expect(handle.mock.calls[0]![0].method).toBe("GET");
    await file.close();
  });
  it.each(["0", "-1", "1.5", "5242881", undefined])(
    "odrzuca nieprawidłową długość %s i zwalnia połączenie",
    async (length) => {
      const { store, handle } = fixture();
      const source = new PassThrough();
      handle.mockResolvedValue(
        length === undefined
          ? response(200, source, { "content-type": "application/pdf" })
          : download(source, length),
      );
      expect(await store.openStream({ key })).toMatchObject({
        error: "UNAVAILABLE",
      });
      expect(source.destroyed).toBe(true);
    },
  );
  it("odrzuca podmieniony typ obiektu i zwalnia połączenie", async () => {
    const { store, handle } = fixture();
    const source = new PassThrough();
    handle.mockResolvedValue(download(source, "3", "text/html"));
    expect(await store.openStream({ key })).toMatchObject({
      error: "UNAVAILABLE",
    });
    expect(source.destroyed).toBe(true);
  });
  it.each([2, 4])(
    "przerywa pobranie o rzeczywistej długości %s zamiast deklarowanej 3",
    async (actual) => {
      const { store, handle } = fixture();
      handle.mockResolvedValue(download(Readable.from([Buffer.alloc(actual)])));
      const file = await requireStream(store);
      await expect(new Response(file.body).arrayBuffer()).rejects.toThrow(
        /^UNAVAILABLE$/,
      );
    },
  );
  it("nie ujawnia błędu źródłowego podczas czytania body", async () => {
    const { store, handle } = fixture();
    const source = new PassThrough();
    handle.mockResolvedValue(download(source));
    const file = await requireStream(store);
    const assertion = expect(
      new Response(file.body).arrayBuffer(),
    ).rejects.toThrow(/^UNAVAILABLE$/);
    source.destroy(new Error("test-secret-key Jan Kowalski"));
    await assertion;
    expect(source.destroyed).toBe(true);
  });
  it.each(["put", "delete", "openStream"] as const)(
    "nie wysyła żądania %s z wcześniej anulowanym sygnałem",
    async (method) => {
      const { store, handle } = fixture();
      expect(
        await store[method]({ ...upload, signal: AbortSignal.abort("PII") }),
      ).toMatchObject({ error: "CANCELLED" });
      expect(handle).not.toHaveBeenCalled();
    },
  );
  it.each(["close", "cancel", "signal"] as const)(
    "zwalnia aktywny strumień przy %s",
    async (action) => {
      const { store, handle } = fixture();
      const source = new PassThrough();
      const controller = new AbortController();
      handle.mockResolvedValue(download(source));
      const file = await requireStream(store, controller.signal);
      const reader = file.body.getReader();
      const pending = reader.read();
      if (action === "cancel") {
        await reader.cancel("PII");
        expect(await pending).toEqual({ value: undefined, done: true });
      } else {
        const assertion = expect(pending).rejects.toThrow(/^CANCELLED$/);
        if (action === "close") await file.close();
        else controller.abort("PII");
        await assertion;
      }
      await file.close();
      expect(source.destroyed).toBe(true);
    },
  );
  it("limit czasu obejmuje także body po otrzymaniu nagłówków", async () => {
    vi.useFakeTimers();
    const { store, handle } = fixture({ timeoutMs: 100 });
    const source = new PassThrough();
    handle.mockResolvedValue(download(source));
    const file = await requireStream(store);
    const assertion = expect(file.body.getReader().read()).rejects.toThrow(
      /^TIMEOUT$/,
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(source.destroyed).toBe(true);
  });
  it("przerywa PUT po czasie i pozostawia niepewny wynik jako błąd", async () => {
    vi.useFakeTimers();
    const { store, handle } = fixture({ timeoutMs: 100 });
    let entered!: () => void;
    const transportStarted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    handle.mockImplementation(
      async (_request, options) =>
        new Promise((_, reject) => {
          options!.abortSignal!.addEventListener(
            "abort",
            () => reject(new Error("test-secret-key")),
            { once: true },
          );
          entered();
        }),
    );
    const pending = store.put(upload);
    await transportStarted;
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toEqual({
      ok: false,
      error: "TIMEOUT",
      retryable: true,
    });
  });
  it("po pełnym pobraniu usuwa timer i nasłuch anulowania", async () => {
    vi.useFakeTimers();
    const { store, handle } = fixture({ timeoutMs: 100 });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    handle.mockResolvedValue(download());
    const file = await requireStream(store, controller.signal);
    await new Response(file.body).arrayBuffer();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    await file.close();
  });
});
