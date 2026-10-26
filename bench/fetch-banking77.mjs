import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const revision = "57ec275d8078af65b7731c2a98be812d844a6d6b";
const url = `https://raw.githubusercontent.com/PolyAI-LDN/task-specific-datasets/${revision}/banking_data/test.csv`;
const intents = [
  "card_arrival", "card_linking", "exchange_rate", "card_payment_wrong_exchange_rate",
  "extra_charge_on_statement", "pending_cash_withdrawal", "fiat_currency_support",
  "card_delivery_estimate", "automatic_top_up", "card_not_working", "exchange_via_app",
];

const response = await fetch(url);
if (!response.ok) throw new Error(`BANKING77 download failed: ${response.status}`);
const csv = await response.text();
const rows = parseCsv(csv).slice(1);
const selected = [];
for (const intent of intents) {
  const matches = rows.filter((row) => row[1] === intent).slice(0, 3);
  if (matches.length !== 3) throw new Error(`Expected three rows for ${intent}`);
  for (const [index, row] of matches.entries()) {
    selected.push({
      sourceId: `test.csv:${rows.indexOf(row) + 2}`,
      intent,
      subject: subjectFor(intent),
      text: row[0],
      selectionIndex: index,
    });
  }
}
const output = `${selected.map(({ selectionIndex, ...row }) => JSON.stringify(row)).join("\n")}\n`;
await writeFile(resolve(root, "banking77-subset.jsonl"), output);
const hash = createHash("sha256").update(output).digest("hex");
console.log(`Wrote ${selected.length} rows to bench/banking77-subset.jsonl`);
console.log(`Subset SHA-256: ${hash}`);
console.log("Update source.json subsetSha256 with this value before committing.");

function subjectFor(intent) {
  if (["exchange_rate", "card_payment_wrong_exchange_rate", "extra_charge_on_statement"].includes(intent)) return "accounting";
  if (["card_linking"].includes(intent)) return "accounts";
  if (["automatic_top_up", "pending_cash_withdrawal"].includes(intent)) return "billing";
  if (["fiat_currency_support"].includes(intent)) return "contact";
  return "general";
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
