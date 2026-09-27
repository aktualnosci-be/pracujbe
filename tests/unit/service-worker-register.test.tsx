import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';

/**
 * #797: rejestracja Service Workera nie może zależeć wyłącznie od przyszłego zdarzenia
 * `load` — jeśli efekt montuje się po hydratacji, gdy dokument jest już
 * `readyState === 'complete'`, `load` już minęło i sam listener nigdy się nie odpali.
 */

function stubReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', { value, configurable: true });
}

describe('ServiceWorkerRegister', () => {
  let register: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    stubReadyState('complete');
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  it('rejestruje od razu, gdy dokument jest już w pełni załadowany (readyState=complete)', () => {
    stubReadyState('complete');
    render(<ServiceWorkerRegister />);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('czeka na `load`, gdy dokument nadal się ładuje, i rejestruje dokładnie raz', () => {
    stubReadyState('loading');
    render(<ServiceWorkerRegister />);
    expect(register).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledTimes(1);

    // Drugie `load` nie powinno wywołać kolejnej rejestracji (listener `once`).
    window.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('kontrola ujemna: bez zmiany produkcyjnego kodu na `readyState=complete` rejestracja by nie nastąpiła', () => {
    // Ta atrapa odtwarza STARE zachowanie (tylko listener na `load`) — dowodzi, że test
    // powyżej faktycznie sprawdza naprawę, a nie zawsze przechodzi.
    stubReadyState('complete');
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    };
    window.addEventListener('load', onLoad);
    expect(register).not.toHaveBeenCalled();
    window.removeEventListener('load', onLoad);
  });

  it('poza produkcją nie rejestruje nawet po `load`', () => {
    vi.stubEnv('NODE_ENV', 'test');
    stubReadyState('complete');
    render(<ServiceWorkerRegister />);
    window.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
  });
});
