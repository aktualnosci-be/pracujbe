/**
 * Składanie wartości `NODE_OPTIONS` (#915).
 *
 * Node rozdziela `NODE_OPTIONS` spacjami; wartość ze spacją (np. ścieżka repozytorium
 * `C:\Users\Jan Kowalski\pracujbe\...`) trzeba ująć w cudzysłów, a wewnątrz cudzysłowu
 * backslash i cudzysłów są poprzedzane backslashem (parser `ParseNodeOptionsEnvVar`).
 * Samo dodanie cudzysłowów wokół surowej ścieżki Windows nie wystarcza — pojedynczy `\`
 * zjadłby następny znak.
 */
export function quoteNodeOptionValue(value) {
  if (!/[\s"\\]/.test(value)) return value;
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}

/** `--require=<ścieżka>` bezpieczne dla `NODE_OPTIONS`, także przy spacji w ścieżce. */
export function requireNodeOption(file) {
  return `--require=${quoteNodeOptionValue(file)}`;
}

/** Dopisuje opcje do istniejącego `NODE_OPTIONS` (pusty/nieustawiony = same nowe). */
export function appendNodeOptions(existing, ...options) {
  return [existing, ...options].filter(Boolean).join(' ');
}
