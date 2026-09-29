/**
 * Minimalne typy API rozszerzenia Chromium używanego tylko przez sterownik zoomu przeglądarki
 * (`zoom-controller.ts`; kod wykonuje się w kontekście strony rozszerzenia, nie w Node).
 * Bez pakietu `@types/chrome` — wystarczy to, po co specyfikacje sięgają.
 */
declare const chrome: {
  tabs: {
    query(queryInfo: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>>;
    setZoom(tabId: number, zoomFactor: number): Promise<void>;
    getZoom(tabId: number): Promise<number>;
  };
};
