import Decimal from "decimal.js";

/**
 * Deterministic invoice arithmetic. Everything is Decimal; no floating point.
 *
 * Rounding and tax rules confirmed by an accountant on 2026-10-28
 * (README, Φ11–Φ14); still to be checked end to end against the myDATA sandbox:
 *  - amounts are rounded per line to 2 decimals, half away from zero (half-up);
 *  - document totals are the sums of the rounded line values, so
 *    net + VAT = gross holds exactly per line and in total;
 *  - when a price includes VAT, the spoken gross is kept exactly and
 *    net = round(gross / (1 + rate)), VAT = gross - net;
 *  - withholdings are computed on the document's total net value.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Dec = InstanceType<typeof D>;

export type PriceBasis = "with_vat" | "without_vat";

export interface CalcLineInput {
  description: string;
  quantity: string;
  /** The amount as spoken: per unit or for the whole line, with or without VAT. */
  amount: string;
  amount_scope: "unit" | "total";
  /** VAT rate in percent, e.g. "24". Comes from the business profile, never from the LLM. */
  vat_rate: string;
  discount_percent?: string;
}

export interface CalcLine extends CalcLineInput {
  net: string;
  vat: string;
  gross: string;
}

export interface WithholdingRule {
  label: string;
  /** Percent of total net, e.g. "20". */
  rate: string;
}

export interface CalcResult {
  price_basis: PriceBasis;
  lines: CalcLine[];
  by_rate: Array<{ vat_rate: string; net: string; vat: string }>;
  withholdings: Array<{ label: string; rate: string; amount: string }>;
  totals: { net: string; vat: string; gross: string; withholdings: string; payable: string };
}

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalcError";
  }
}

function dec(value: string, field: string): Dec {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new CalcError(`${field}: not a non-negative decimal: ${value}`);
  return new D(value);
}

function r2(x: Dec): Dec {
  return x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function s2(x: Dec): string {
  return x.toFixed(2);
}

export function calculate(lines: CalcLineInput[], priceBasis: PriceBasis, withholdings: WithholdingRule[] = []): CalcResult {
  if (lines.length === 0) throw new CalcError("no lines");
  const out: CalcLine[] = lines.map((line, i) => {
    const quantity = dec(line.quantity, `line ${i + 1} quantity`);
    if (quantity.isZero()) throw new CalcError(`line ${i + 1}: quantity must be positive`);
    const amount = dec(line.amount, `line ${i + 1} amount`);
    const rate = dec(line.vat_rate, `line ${i + 1} vat_rate`);
    if (rate.gt(100)) throw new CalcError(`line ${i + 1}: VAT rate above 100%`);
    const discount = dec(line.discount_percent ?? "0", `line ${i + 1} discount`);
    if (discount.gt(100)) throw new CalcError(`line ${i + 1}: discount above 100%`);

    const lineAmount = line.amount_scope === "total" ? amount : amount.times(quantity);
    const afterDiscount = r2(lineAmount.times(new D(100).minus(discount)).dividedBy(100));
    let net: Dec;
    let vat: Dec;
    if (priceBasis === "without_vat") {
      net = afterDiscount;
      vat = r2(net.times(rate).dividedBy(100));
    } else {
      net = r2(afterDiscount.times(100).dividedBy(rate.plus(100)));
      vat = afterDiscount.minus(net);
    }
    return { ...line, net: s2(net), vat: s2(vat), gross: s2(net.plus(vat)) };
  });

  const sum = (pick: (l: CalcLine) => string, ls = out) => ls.reduce((acc, l) => acc.plus(pick(l)), new D(0));
  const net = sum((l) => l.net);
  const vat = sum((l) => l.vat);

  const rates = [...new Set(out.map((l) => new D(l.vat_rate).toString()))].sort((a, b) => Number(b) - Number(a));
  const by_rate = rates.map((rate) => {
    const ls = out.filter((l) => new D(l.vat_rate).toString() === rate);
    return { vat_rate: rate, net: s2(sum((l) => l.net, ls)), vat: s2(sum((l) => l.vat, ls)) };
  });

  const wh = withholdings.map((w) => {
    const rate = dec(w.rate, `withholding ${w.label}`);
    if (rate.gt(100)) throw new CalcError(`withholding ${w.label}: rate above 100%`);
    return { label: w.label, rate: rate.toString(), amount: s2(r2(net.times(rate).dividedBy(100))) };
  });
  const whTotal = wh.reduce((acc, w) => acc.plus(w.amount), new D(0));
  const gross = net.plus(vat);

  return {
    price_basis: priceBasis,
    lines: out,
    by_rate,
    withholdings: wh,
    totals: { net: s2(net), vat: s2(vat), gross: s2(gross), withholdings: s2(whTotal), payable: s2(gross.minus(whTotal)) },
  };
}

/** Independent re-check used before issuing: every identity the document must satisfy. */
export function consistencyProblems(result: CalcResult): string[] {
  const problems: string[] = [];
  let net = new D(0);
  let vat = new D(0);
  result.lines.forEach((l, i) => {
    if (!new D(l.net).plus(l.vat).eq(l.gross)) problems.push(`Γραμμή ${i + 1}: καθαρή αξία + ΦΠΑ ≠ σύνολο.`);
    net = net.plus(l.net);
    vat = vat.plus(l.vat);
  });
  const t = result.totals;
  if (!net.eq(t.net)) problems.push("Το σύνολο καθαρής αξίας δεν ισούται με το άθροισμα των γραμμών.");
  if (!vat.eq(t.vat)) problems.push("Το σύνολο ΦΠΑ δεν ισούται με το άθροισμα των γραμμών.");
  if (!new D(t.net).plus(t.vat).eq(t.gross)) problems.push("Καθαρή αξία + ΦΠΑ ≠ συνολική αξία.");
  const wh = result.withholdings.reduce((acc, w) => acc.plus(w.amount), new D(0));
  if (!wh.eq(t.withholdings) || !new D(t.gross).minus(wh).eq(t.payable)) problems.push("Οι κρατήσεις ή το πληρωτέο δεν συμφωνούν.");
  return problems;
}
