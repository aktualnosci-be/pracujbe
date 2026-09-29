// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { downloadPrivateFile } from '@/lib/files/client-download';

function deps(response: Response | Error) {
  const click = vi.fn();
  const doc = document;
  const created: HTMLAnchorElement[] = [];
  const spy = vi.spyOn(doc, 'createElement').mockImplementation(((tag: string) => {
    const el = Document.prototype.createElement.call(doc, tag) as HTMLAnchorElement;
    if (tag === 'a') {
      el.click = click;
      created.push(el);
    }
    return el;
  }) as typeof doc.createElement);
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { click, created, spy, fetchImpl, createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() };
}

describe('downloadPrivateFile (FS30-04)', () => {
  it('sukces: zapisuje plik linkiem download pod nazwą pliku', async () => {
    const d = deps(new Response('abc', { status: 200 }));
    expect(await downloadPrivateFile('/api/files/cv/1?t=a', 'cv.pdf', d)).toBe(true);
    expect(d.click).toHaveBeenCalledOnce();
    expect(d.created[0]?.download).toBe('cv.pdf');
    d.spy.mockRestore();
  });

  it.each([404, 503])('odpowiedź %i: false, bez zapisu pliku i bez nawigacji', async (status) => {
    const d = deps(new Response(null, { status }));
    expect(await downloadPrivateFile('/api/files/cv/1?t=a', 'cv.pdf', d)).toBe(false);
    expect(d.click).not.toHaveBeenCalled();
    d.spy.mockRestore();
  });

  it('błąd sieci: false', async () => {
    const d = deps(new Error('net'));
    expect(await downloadPrivateFile('/x', 'cv.pdf', d)).toBe(false);
    expect(d.click).not.toHaveBeenCalled();
    d.spy.mockRestore();
  });
});
