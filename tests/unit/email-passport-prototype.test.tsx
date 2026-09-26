import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import { EmailLayout, EmailPassport } from '@/emails/_components';

/**
 * Sekcja „paszportu” w mailach = kalka `prototype/materials/newsletter.html` (#6).
 * Porównujemy typografię etykiety pola i akapitu z linkiem oferty z prototypem:
 * - etykieta (`<span style="color:#777;font-size:11px">`) bez światła — letter-spacing ma
 *   tylko nadtytuł „PASZPORT PRACY”;
 * - akapit linku `font-size:13px; margin:17px 0 0` — w aplikacji 12 px dopełnienia komórki
 *   pól + 5 px marginesu = 17 px odstępu, rozmiar 13 px.
 */
const PROTOTYPE = readFileSync(
  resolve(__dirname, '../../docs/design/people-passport/prototype/materials/newsletter.html'),
  'utf8',
);

type Styles = Record<string, string>;

function parseStyle(value: string | null): Styles {
  const styles: Styles = {};
  for (const part of (value ?? '').split(';')) {
    const index = part.indexOf(':');
    if (index < 0) continue;
    styles[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim();
  }
  return styles;
}

function px(value: string | undefined): number {
  return value ? Number.parseFloat(value) : 0;
}

/** Górny margines z `margin` (1–4 wartości) albo `margin-top`. */
function marginTop(styles: Styles): number {
  if (styles['margin-top']) return px(styles['margin-top']);
  return px(styles.margin?.split(/\s+/)[0]);
}

interface PassportTypography {
  labelLetterSpacing: number;
  labelFontSize: number;
  linkFontSize: number;
  /** Odstęp między polami a linkiem: dolne dopełnienie komórki pola + górny margines akapitu. */
  linkGap: number;
}

function prototypeTypography(): PassportTypography {
  const doc = new DOMParser().parseFromString(PROTOTYPE, 'text/html');
  const label = doc.querySelector('td > span[style*="font-size:11px"]');
  const linkParagraph = doc.querySelector('p > a[href="{{offers_url}}"]')?.parentElement ?? null;
  if (!label || !linkParagraph) throw new Error('Nie znaleziono paszportu w prototypie');
  const labelStyle = parseStyle(label.getAttribute('style'));
  const linkStyle = parseStyle(linkParagraph.getAttribute('style'));
  const cellStyle = parseStyle(label.parentElement?.getAttribute('style') ?? null);
  return {
    labelLetterSpacing: px(labelStyle['letter-spacing']),
    labelFontSize: px(labelStyle['font-size']),
    linkFontSize: px(linkStyle['font-size']),
    linkGap: px(cellStyle['padding-bottom']) + marginTop(linkStyle),
  };
}

function appTypography(html: string): PassportTypography {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cell = doc.querySelector('[data-test-passport-cell]');
  const label = cell?.querySelector('p');
  const linkParagraph = doc.querySelector('[data-test-passport] a[href$="/oferta"]')?.parentElement ?? null;
  if (!cell || !label || !linkParagraph) throw new Error('Nie znaleziono paszportu w mailu');
  const cellStyle = parseStyle(cell.getAttribute('style'));
  const labelStyle = parseStyle(label.getAttribute('style'));
  const linkStyle = parseStyle(linkParagraph.getAttribute('style'));
  const padding = cellStyle.padding?.split(/\s+/) ?? [];
  return {
    labelLetterSpacing: px(labelStyle['letter-spacing']),
    labelFontSize: px(labelStyle['font-size']),
    linkFontSize: px(linkStyle['font-size']),
    linkGap: px(padding[2] ?? padding[0]) + marginTop(linkStyle),
  };
}

async function renderPassport(): Promise<string> {
  return render(
    <EmailLayout locale="pl" preview="Podgląd" title="Temat">
      <EmailPassport
        eyebrow="Paszport pracy"
        title="Operator wózka widłowego"
        fields={[
          { label: 'Miejsce', value: 'Antwerpia', data: ['data-test-passport-cell', ''] },
          { label: 'Wynagrodzenie', value: '17–20 €' },
        ]}
        link={{ href: 'https://pracuj.be/pl/oferta', label: 'Zobacz ofertę' }}
        sectionData={{ 'data-test-passport': '' }}
      />
    </EmailLayout>,
  );
}

describe('paszport w mailu = newsletter.html (#6)', () => {
  it('prototyp: etykieta 11 px bez światła, link 13 px, 17 px nad linkiem', () => {
    expect(prototypeTypography()).toEqual({
      labelLetterSpacing: 0,
      labelFontSize: 11,
      linkFontSize: 13,
      linkGap: 17,
    });
  });

  it('mail ma tę samą typografię etykiety i linku co prototyp', async () => {
    expect(appTypography(await renderPassport())).toEqual(prototypeTypography());
  });

  it('kontrola ujemna: dawne światło etykiety i domyślny akapit <Text> są wykrywane', async () => {
    const html = await renderPassport();
    const mutated = html
      .replace(/(data-test-passport-cell[^>]*>\s*<p[^>]*style=")/, '$1letter-spacing:0.5px;')
      .replace(/(<p[^>]*style="[^"]*)font-size:13px;line-height:20px;(margin:5px 0 0 0)/, '$1font-size:14px;line-height:24px;$2');
    expect(mutated).not.toBe(html);
    const typography = appTypography(mutated);
    expect(typography.labelLetterSpacing).toBe(0.5);
    expect(typography.linkFontSize).toBe(14);
    expect(typography).not.toEqual(prototypeTypography());
  });
});
