// Lustro `cityKey` z src/lib/matching/belgian-cities.ts dla skryptów Node (bez TS).
// Zgodność obu implementacji pilnuje tests/unit/matching-locations.test.ts.
export function cityKey(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, ' ')
    .trim();
}
