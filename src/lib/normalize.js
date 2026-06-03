// Normalizes messy manufacturer names into a canonical form.
//
// Strategy (no AI needed for this cheap, deterministic step):
//   1. Clean: trim, collapse whitespace, strip trailing legal suffixes
//      (INC, CORP, LLC, LTD, CO, etc.) and punctuation.
//   2. Title-case the result.
//   3. Map known aliases to a single canonical brand via ALIASES.
//
// The alias map is the only thing you maintain by hand, and only for
// brands that collide (e.g. "HILL ROM" vs "Hillrom"). Everything else
// is handled generically, so new manufacturers normalize sensibly
// without code changes.

const LEGAL_SUFFIXES = [
  "inc", "incorporated", "corp", "corporation", "co", "company",
  "llc", "ltd", "limited", "gmbh", "ag", "sa", "srl", "bv", "plc",
];

// Canonical-name overrides keyed by the cleaned+lowercased name.
// Add an entry only when two raw spellings must merge to one brand.
const ALIASES = {
  "hill rom": "Hillrom",
  "hillrom": "Hillrom",
  "philips": "Philips",
  "ge healthcare": "GE Healthcare",
  "ge": "GE Healthcare",
  "zoll medical": "ZOLL Medical",
  "zoll": "ZOLL Medical",
  "biosonic": "BioSonic",
  "thermo scientific": "Thermo Scientific",
  "lab corp": "LabCorp",
  "labcorp": "LabCorp",
  "baxter healthcare": "Baxter Healthcare",
  "arjo": "Arjo",
  "american diagnostic": "American Diagnostic",
};

function clean(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().replace(/\s+/g, " ");
  // strip a trailing legal suffix (with optional dot), possibly repeated
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      const re = new RegExp(`[\\s,]+${suf}\\.?$`, "i");
      if (re.test(s)) {
        s = s.replace(re, "").trim();
        changed = true;
      }
    }
  }
  return s.replace(/[.,]+$/, "").trim();
}

function titleCase(s) {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function normalizeManufacturer(raw) {
  // 1. Whitespace/trim only, then alias check — this protects brands whose
  //    name legitimately contains a legal-suffix word (e.g. "Lab Corp").
  const whitespaceClean = String(raw ?? "").trim().replace(/\s+/g, " ").replace(/[.,]+$/, "");
  const k0 = whitespaceClean.toLowerCase();
  if (ALIASES[k0]) return ALIASES[k0];

  // 2. Strip legal suffixes, alias check again, else title-case.
  const cleaned = clean(raw);
  const k1 = cleaned.toLowerCase();
  if (ALIASES[k1]) return ALIASES[k1];
  return titleCase(cleaned);
}
