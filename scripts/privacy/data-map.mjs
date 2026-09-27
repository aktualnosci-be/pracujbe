import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTIVITIES,
  DATA_CATEGORY_LABELS,
  DATA_SUBJECT_LABELS,
  PERSONAL_COLUMN_PATTERNS,
  TABLE_CLASSIFICATION,
} from "../../src/lib/privacy/data-map.ts";
import { PROCESSORS } from "../../src/lib/privacy/processors.ts";
import { EMAIL_PAYLOAD_FIELDS } from "../../src/lib/email/payload-fields.ts";
import { AUTH_EMAIL_TYPES, GUEST_EMAIL_TYPES, QUEUED_EMAIL_TYPES } from "../../src/emails/wiring.ts";
import { extractEmailPayloads } from "./email-payloads.mjs";
import { loadMigrationFiles, parseSchema } from "./schema.mjs";

/**
 * Mapa danych osobowych z repozytorium (#485, #488, #503, #504).
 *
 *   node scripts/privacy/data-map.mjs          # zapisuje docs/legal-drafts/data-map.generated.md
 *   node scripts/privacy/data-map.mjs --check  # błąd, gdy klasyfikacja niepełna lub plik nieaktualny
 *
 * Źródła: migracje produkcyjne (schemat), `src/lib/privacy/data-map.ts` (klasyfikacja),
 * `src/lib/privacy/processors.ts` (usługi zewnętrzne), `src/emails/wiring.ts` + funkcje SQL
 * (zakres danych w e-mailach). Wynik jest deterministyczny — bez dat i hashy commitów.
 */

export const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const OUTPUT = "docs/legal-drafts/data-map.generated.md";

export function isPersonalLooking(column) {
  return PERSONAL_COLUMN_PATTERNS.some((pattern) => pattern.test(column));
}

/** Zwraca listę błędów kontraktu klasyfikacji (pusta = w porządku). */
export function checkClassification(tables, classification = TABLE_CLASSIFICATION) {
  const errors = [];
  for (const [name, table] of tables) {
    const entry = classification[name];
    if (!entry) {
      const hits = [...table.columns.keys()].filter(isPersonalLooking);
      errors.push(
        `Tabela ${name} (${table.source}) nie ma klasyfikacji w src/lib/privacy/data-map.ts` +
          (hits.length ? ` — kolumny wyglądające na dane osobowe: ${hits.join(", ")}` : ""),
      );
      continue;
    }
    for (const [column, info] of table.columns) {
      const classified = column in entry.columns || column in (entry.notPersonal ?? {});
      if (isPersonalLooking(column) && !classified) {
        errors.push(
          `Kolumna ${name}.${column} (${info.source}) wygląda na dane osobowe i nie ma klasyfikacji ` +
            `(dodaj ją do columns albo notPersonal w src/lib/privacy/data-map.ts).`,
        );
      }
    }
    for (const column of [...Object.keys(entry.columns), ...Object.keys(entry.notPersonal ?? {})]) {
      if (!table.columns.has(column)) errors.push(`Klasyfikacja wskazuje nieistniejącą kolumnę ${name}.${column}.`);
    }
    for (const activity of entry.activities) {
      if (!(activity in ACTIVITIES)) errors.push(`Tabela ${name}: nieznana czynność ${activity}.`);
    }
    if (Object.keys(entry.columns).length > 0 && entry.activities.length === 0) {
      errors.push(`Tabela ${name} ma dane osobowe, ale nie jest przypisana do żadnej czynności.`);
    }
  }
  for (const name of Object.keys(classification)) {
    if (!tables.has(name)) errors.push(`Klasyfikacja wskazuje tabelę ${name}, której nie ma w migracjach.`);
  }
  const processorIds = new Set(PROCESSORS.map((p) => p.id));
  for (const [id, activity] of Object.entries(ACTIVITIES)) {
    for (const processor of activity.processors) {
      if (!processorIds.has(processor)) errors.push(`Czynność ${id}: nieznany dostawca ${processor}.`);
    }
  }
  return errors;
}

const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (value) => `\`${value}\``;

export function renderDataMap(tables, emailPayloads) {
  const personal = [...tables.keys()].filter((n) => Object.keys(TABLE_CLASSIFICATION[n]?.columns ?? {}).length > 0).sort();
  const other = [...tables.keys()].filter((n) => !personal.includes(n)).sort();
  const processorName = Object.fromEntries(PROCESSORS.map((p) => [p.id, p.name]));
  const lines = [];
  const push = (...l) => lines.push(...l);

  push(
    "# Mapa danych osobowych (generowana z repozytorium)",
    "",
    "> **PROJEKT — do weryfikacji prawnika, nieopublikowany.**",
    "> Plik generowany — nie edytuj ręcznie. Źródła: migracje produkcyjne, `src/lib/privacy/data-map.ts`,",
    "> `src/lib/privacy/processors.ts`, `src/emails/wiring.ts`. Odśwież: `node scripts/privacy/data-map.mjs`.",
    "> Mapa opisuje fakty z kodu. Role administratorów, podstawy prawne, regiony, transfery i umowy",
    "> ustala właściciel z prawnikiem — pola „DO UZUPEŁNIENIA”. Nic z tego pliku nie trafia do UI.",
    "",
    `Tabele w migracjach: ${tables.size}; z danymi osobowymi: ${personal.length}; bez danych osobowych: ${other.length}.`,
    "",
    "## 1. Czynności przetwarzania → tabele i usługi",
    "",
    "| Czynność | Co robi kod | Tabele | Usługi zewnętrzne | Retencja/usuwanie w kodzie |",
    "|---|---|---|---|---|",
  );
  for (const [id, activity] of Object.entries(ACTIVITIES)) {
    const activityTables = personal.filter((n) => TABLE_CLASSIFICATION[n].activities.includes(id));
    push(
      `| ${cell(activity.name)} (${code(id)}) | ${cell(activity.inCode)} | ${activityTables.map(code).join(", ") || "—"} | ` +
        `${activity.processors.map((p) => processorName[p]).join(", ")} | ${cell(activity.retentionInCode ?? "Kod nie usuwa danych — do ustalenia")} |`,
    );
  }

  push("", "## 2. Usługi zewnętrzne (subprocesorzy — kandydaci do weryfikacji)", "");
  for (const p of PROCESSORS) {
    push(
      `### ${p.name} (${code(p.id)})`,
      "",
      `- **Cel w portalu:** ${p.purpose}`,
      `- **Kategorie danych:** ${p.dataCategories.join("; ")}`,
      `- **Osoby:** ${p.dataSubjects.join(", ")}`,
      `- **Aktywacja:** ${p.activation}`,
      `- **Kod:** ${p.codeRefs.map(code).join(", ")}`,
      ...p.notes.map((n) => `- **Uwaga:** ${n}`),
      `- **Rola (procesor/administrator):** ${p.role}`,
      `- **Region przetwarzania:** ${p.region}`,
      `- **Podstawa transferu poza EOG:** ${p.transferBasis}`,
      `- **Umowa (DPA):** ${p.contract}`,
      `- **Retencja u dostawcy:** ${p.providerRetention}`,
      "",
    );
  }

  push("## 3. Tabele z danymi osobowymi", "");
  for (const name of personal) {
    const entry = TABLE_CLASSIFICATION[name];
    const table = tables.get(name);
    push(
      `### ${code(name)}`,
      "",
      `- **Migracja:** ${code(table.source)}`,
      `- **Czynności:** ${entry.activities.map((a) => ACTIVITIES[a].name).join(", ")}`,
      `- **Osoby:** ${entry.subjects.map((s) => DATA_SUBJECT_LABELS[s]).join(", ") || "—"}`,
      ...(entry.note ? [`- **Uwaga:** ${entry.note}`] : []),
      "",
      "| Kolumna | Kategoria | Wprowadzona w |",
      "|---|---|---|",
      ...Object.entries(entry.columns).map(
        ([column, category]) => `| ${code(column)} | ${DATA_CATEGORY_LABELS[category]} | ${code(table.columns.get(column).source)} |`,
      ),
      ...Object.entries(entry.notPersonal ?? {}).map(([column, why]) => `| ${code(column)} | nie dotyczy: ${cell(why)} | — |`),
      "",
    );
  }

  push(
    "## 4. Treść e-maili (payload kolejki → dostawca poczty)",
    "",
    "Klucze z `jsonb_build_object` w aktualnych definicjach funkcji SQL. Worker dokłada imię odbiorcy",
    "z `profiles`, link do panelu i stopkę wypisania (`src/lib/email/delivery-data.ts`,",
    "`src/lib/email/guest-delivery.ts`). E-maile konta (`src/lib/email/auth-email.ts`):",
    `${AUTH_EMAIL_TYPES.map(code).join(", ")} — zawierają link z tokenem.`,
    "",
    "Minimalizacja (#503): do szablonu — a więc do dostawcy poczty — trafiają tylko pola z listy",
    "`src/lib/email/payload-fields.ts`; resztę payloadu worker odrzuca przed renderem (zostaje w bazie).",
    "Wyjątek spoza SQL: `jobOffer.messageExcerpt` — worker czyta `offers.message` przy wysyłce i przekazuje",
    "wyłącznie cytat ≤ 200 znaków bez e-maili, telefonów, URL-i i identyfikatorów (`src/lib/email/message-excerpt.ts`).",
    "Wiersz dla odbiorcy firmowego wychodzi tylko, gdy przy odbiorze z kolejki nadal ma uprawnienie",
    "(`email_recipient_authorized` w `claim_email_batch`).",
    "",
    "| Szablon | Pola payloadu | Odrzucane przez workera | Funkcje SQL |",
    "|---|---|---|---|",
  );
  for (const template of [...QUEUED_EMAIL_TYPES, ...GUEST_EMAIL_TYPES].slice().sort()) {
    const found = emailPayloads.get(template);
    const allowed = new Set(EMAIL_PAYLOAD_FIELDS[template] ?? []);
    const dropped = found ? found.keys.filter((key) => !allowed.has(key)) : [];
    push(
      `| ${code(template)} | ${found ? found.keys.map(code).join(", ") || "—" : "nie znaleziono w migracjach"} | ` +
        `${dropped.map(code).join(", ") || "—"} | ` +
        `${found ? found.functions.map(code).join(", ") : "—"} |`,
    );
  }

  push("", "## 5. Tabele bez danych osobowych", "", "| Tabela | Uzasadnienie |", "|---|---|");
  for (const name of other) push(`| ${code(name)} | ${cell(TABLE_CLASSIFICATION[name]?.note ?? "brak klasyfikacji")} |`);
  push("");
  return lines.join("\n");
}

export function buildDataMap(root = ROOT) {
  const files = loadMigrationFiles(root);
  const tables = parseSchema(files);
  const emailPayloads = extractEmailPayloads(files, [...QUEUED_EMAIL_TYPES, ...GUEST_EMAIL_TYPES]);
  return { tables, errors: checkClassification(tables), markdown: renderDataMap(tables, emailPayloads) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, markdown } = buildDataMap();
  if (errors.length) {
    console.error(errors.map((e) => `✗ ${e}`).join("\n"));
    process.exit(1);
  }
  const target = resolve(ROOT, OUTPUT);
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {}
    if (current !== markdown) {
      console.error(`✗ ${OUTPUT} jest nieaktualny — uruchom: node scripts/privacy/data-map.mjs`);
      process.exit(1);
    }
    console.log(`✓ ${OUTPUT} aktualny`);
  } else {
    writeFileSync(target, markdown);
    console.log(`✓ zapisano ${OUTPUT}`);
  }
}
