import { inflateSync } from "node:zlib";

/**
 * Minimalny dekoder PNG do porównań pikseli w testach (#378). Chromium w różnych rewizjach
 * koduje ten sam obraz innym strumieniem IDAT (kompresja/filtry), więc porównanie bajtów pliku
 * fałszywie zgłasza różnicę. Obsługuje 8 bitów na kanał, RGB/RGBA, bez przeplotu — inny
 * format to błąd, nie ciche przejście.
 */
export type PngPixels = {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
};

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Record<number, number> = { 2: 3, 6: 4 };

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

export function decodePng(file: Buffer): PngPixels {
  if (!file.subarray(0, 8).equals(SIGNATURE))
    throw new Error("To nie jest plik PNG.");
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colorType, , , interlace] = body.subarray(8, 13);
      channels = CHANNELS[colorType ?? -1] ?? 0;
      if (depth !== 8 || !channels || interlace !== 0) {
        throw new Error(
          `Nieobsługiwany format PNG (głębia ${depth}, typ ${colorType}, przeplot ${interlace}).`,
        );
      }
    } else if (type === "IDAT") {
      idat.push(body);
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? data[y * stride + x - channels]! : 0;
      const up = y > 0 ? data[(y - 1) * stride + x]! : 0;
      const upLeft =
        x >= channels && y > 0 ? data[(y - 1) * stride + x - channels]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, upLeft)
                  : Number.NaN;
      if (Number.isNaN(predictor))
        throw new Error(`Nieznany filtr PNG ${filter}.`);
      data[y * stride + x] = (row[x]! + predictor) & 0xff;
    }
  }
  return { width, height, channels, data };
}
