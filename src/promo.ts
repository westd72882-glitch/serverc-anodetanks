// ============================================================================
// Promo codes, defined entirely in the PROMOCODE environment variable so
// they can be added/changed on the host without a code change or a
// migration.
//
// Format of one code:
//     reward,500c.activ,1.name,anode67
//
//   reward,<amount><currency>  -- 500c = 500 credits, 500g = 500 gold
//   activ,<n>                  -- how many times it may be redeemed IN TOTAL
//                                 across all accounts
//   name,<code>                -- what the player types in
//
// Several codes can be listed at once, separated by ';' :
//     reward,500c.activ,1.name,anode67;reward,100g.activ,50.name,launch
//
// Parsing is deliberately forgiving about field order and whitespace, but
// strict about the values themselves: a malformed entry is skipped with a
// warning at startup rather than silently becoming a code that grants 0 of
// nothing, or worse, an unlimited one.
// ============================================================================

export type PromoCurrency = "credits" | "gold";

export interface PromoCode {
  name: string;          // lowercased; what the player types
  amount: number;
  currency: PromoCurrency;
  maxActivations: number;
}

function parseOne(raw: string): PromoCode | null {
  const parts = raw.split(".").map((p) => p.trim()).filter((p) => p.length > 0);

  let amount = 0;
  let currency: PromoCurrency | null = null;
  let maxActivations = 0;
  let name = "";

  for (const part of parts) {
    const commaIdx = part.indexOf(",");
    if (commaIdx < 0) continue;
    const key = part.slice(0, commaIdx).trim().toLowerCase();
    const value = part.slice(commaIdx + 1).trim();

    if (key === "reward") {
      // Trailing letter picks the currency: c = credits, g = gold.
      const match = /^(\d+)\s*([cg])$/i.exec(value);
      if (!match) return null;
      amount = parseInt(match[1], 10);
      currency = match[2].toLowerCase() === "g" ? "gold" : "credits";
    } else if (key === "activ") {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      maxActivations = n;
    } else if (key === "name") {
      name = value.toLowerCase();
    }
  }

  if (!name || !currency || amount <= 0 || maxActivations <= 0) return null;
  return { name, amount, currency, maxActivations };
}

let cached: Map<string, PromoCode> | null = null;

export function getPromoCodes(): Map<string, PromoCode> {
  if (cached) return cached;
  cached = new Map();

  const raw = process.env.PROMOCODE;
  if (!raw || !raw.trim()) {
    console.log("PROMOCODE not set -- no promo codes are active.");
    return cached;
  }

  for (const chunk of raw.split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const parsed = parseOne(trimmed);
    if (!parsed) {
      console.warn(`PROMOCODE: skipping malformed entry: "${trimmed}"`);
      continue;
    }
    cached.set(parsed.name, parsed);
    console.log(
      `Promo code loaded: "${parsed.name}" -> ${parsed.amount} ${parsed.currency}, ${parsed.maxActivations} activation(s)`
    );
  }
  return cached;
}

export function findPromoCode(name: string): PromoCode | undefined {
  return getPromoCodes().get(name.trim().toLowerCase());
}
