import { describe, expect, it } from "vitest";
import fc from "fast-check";
import Decimal from "decimal.js";
import { calculate, consistencyProblems, CalcError, type CalcLineInput } from "../src/invoicing/calc";

// Rates here are test data; real rates come from each user's business profile.
const line = (over: Partial<CalcLineInput> = {}): CalcLineInput => ({
  description: "Υπηρεσία",
  quantity: "1",
  amount: "100",
  amount_scope: "unit",
  vat_rate: "24",
  ...over,
});

describe("calculate: examples", () => {
  it("adds VAT to a net price", () => {
    const r = calculate([line()], "without_vat");
    expect(r.totals).toEqual({ net: "100.00", vat: "24.00", gross: "124.00", withholdings: "0.00", payable: "124.00" });
  });

  it("extracts VAT from a gross price and keeps the gross exact", () => {
    const r = calculate([line({ amount: "80" })], "with_vat");
    expect(r.lines[0]).toMatchObject({ net: "64.52", vat: "15.48", gross: "80.00" });
  });

  it("rounds half up per line", () => {
    // 0.0625 * 24% = 0.015 -> 0.02 ; net 10.0625 -> 10.06 (rounded first, then VAT)
    expect(calculate([line({ amount: "10.0625" })], "without_vat").lines[0]).toMatchObject({ net: "10.06", vat: "2.41", gross: "12.47" });
    expect(calculate([line({ amount: "0.0625", vat_rate: "24" })], "without_vat").lines[0]).toMatchObject({ net: "0.06", vat: "0.01" });
    expect(calculate([line({ amount: "1.125", vat_rate: "0" })], "without_vat").lines[0]!.net).toBe("1.13");
  });

  it("multiplies unit prices by quantity, but not totals", () => {
    expect(calculate([line({ quantity: "3", amount: "30" })], "without_vat").totals.net).toBe("90.00");
    expect(calculate([line({ quantity: "3", amount: "100", amount_scope: "total" })], "without_vat").totals.net).toBe("100.00");
    expect(calculate([line({ quantity: "1.5", amount: "40" })], "without_vat").totals.net).toBe("60.00");
  });

  it("groups several VAT rates", () => {
    const r = calculate(
      [line({ amount: "100", vat_rate: "24" }), line({ amount: "50", vat_rate: "13" }), line({ amount: "20", vat_rate: "0" }), line({ amount: "10", vat_rate: "24" })],
      "without_vat",
    );
    expect(r.by_rate).toEqual([
      { vat_rate: "24", net: "110.00", vat: "26.40" },
      { vat_rate: "13", net: "50.00", vat: "6.50" },
      { vat_rate: "0", net: "20.00", vat: "0.00" },
    ]);
    expect(r.totals).toMatchObject({ net: "180.00", vat: "32.90", gross: "212.90" });
  });

  it("applies percentage discounts before VAT", () => {
    expect(calculate([line({ amount: "200", discount_percent: "10" })], "without_vat").lines[0]).toMatchObject({ net: "180.00", vat: "43.20" });
    expect(calculate([line({ amount: "124", discount_percent: "50" })], "with_vat").lines[0]).toMatchObject({ gross: "62.00", net: "50.00", vat: "12.00" });
  });

  it("handles exempt lines (0%)", () => {
    expect(calculate([line({ amount: "75", vat_rate: "0" })], "with_vat").totals).toMatchObject({ net: "75.00", vat: "0.00", gross: "75.00" });
  });

  it("computes withholdings on net and the payable amount", () => {
    const r = calculate([line({ amount: "1000" })], "without_vat", [{ label: "Παρακράτηση", rate: "20" }]);
    expect(r.withholdings).toEqual([{ label: "Παρακράτηση", rate: "20", amount: "200.00" }]);
    expect(r.totals).toMatchObject({ gross: "1240.00", withholdings: "200.00", payable: "1040.00" });
  });

  it.each([
    [[], "no lines"],
    [[line({ quantity: "0" })], "quantity"],
    [[line({ amount: "-5" })], "amount"],
    [[line({ amount: "1e3" })], "amount"],
    [[line({ vat_rate: "150" })], "VAT rate"],
    [[line({ discount_percent: "101" })], "discount"],
  ] as Array<[CalcLineInput[], string]>)("rejects invalid input (%#)", (lines, msg) => {
    expect(() => calculate(lines, "without_vat")).toThrow(CalcError);
    expect(() => calculate(lines, "without_vat")).toThrow(msg);
  });

  it("detects tampered results", () => {
    const r = calculate([line()], "without_vat");
    expect(consistencyProblems(r)).toEqual([]);
    expect(consistencyProblems({ ...r, totals: { ...r.totals, vat: "24.01" } }).length).toBeGreaterThan(0);
    expect(consistencyProblems({ ...r, lines: [{ ...r.lines[0]!, gross: "124.01" }] }).length).toBeGreaterThan(0);
  });
});

// --- property-based -----------------------------------------------------------

const money = fc.integer({ min: 0, max: 10_000_000 }).map((c) => (c / 100).toFixed(2));
const precise = fc.integer({ min: 0, max: 100_000_000 }).map((c) => new Decimal(c).dividedBy(10_000).toString());
const qty = fc.oneof(fc.integer({ min: 1, max: 500 }).map(String), fc.integer({ min: 1, max: 100 }).map((h) => new Decimal(h).dividedBy(4).toString()));
const rate = fc.constantFrom("0", "4", "6", "9", "13", "17", "24");
const lineArb = fc.record({
  description: fc.constant("x"),
  quantity: qty,
  amount: fc.oneof(money, precise),
  amount_scope: fc.constantFrom("unit" as const, "total" as const),
  vat_rate: rate,
  discount_percent: fc.option(fc.integer({ min: 0, max: 100 }).map(String), { nil: undefined }),
});
const basis = fc.constantFrom("with_vat" as const, "without_vat" as const);
const twoDecimals = /^\d+\.\d{2}$/;

describe("calculate: properties", () => {
  it("is always internally consistent and uses exactly two decimals", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 20 }), basis, fc.option(fc.integer({ min: 0, max: 50 }).map(String), { nil: undefined }), (lines, b, wh) => {
        const r = calculate(lines, b, wh ? [{ label: "w", rate: wh }] : []);
        expect(consistencyProblems(r)).toEqual([]);
        for (const l of r.lines) for (const v of [l.net, l.vat, l.gross]) expect(v).toMatch(twoDecimals);
        for (const v of Object.values(r.totals)) expect(v).toMatch(/^-?\d+\.\d{2}$/);
      }),
    );
  });

  it("keeps the spoken amount exact: gross for VAT-inclusive, net for VAT-exclusive prices", () => {
    fc.assert(
      fc.property(money, rate, basis, (amount, r, b) => {
        const l = calculate([{ description: "x", quantity: "1", amount, amount_scope: "unit", vat_rate: r }], b).lines[0]!;
        expect(b === "with_vat" ? l.gross : l.net).toBe(new Decimal(amount).toFixed(2));
      }),
    );
  });

  it("never produces negative values and VAT never exceeds its rate share by more than a cent", () => {
    fc.assert(
      fc.property(lineArb, basis, (l, b) => {
        const out = calculate([l], b).lines[0]!;
        for (const v of [out.net, out.vat, out.gross]) expect(new Decimal(v).gte(0)).toBe(true);
        const expected = new Decimal(out.net).times(l.vat_rate).dividedBy(100);
        expect(new Decimal(out.vat).minus(expected).abs().lte("0.01")).toBe(true);
      }),
    );
  });

  it("totals equal the sum of independently calculated lines", () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 10 }), basis, (lines, b) => {
        const whole = calculate(lines, b);
        const sum = lines.reduce((acc, l) => acc.plus(calculate([l], b).totals.gross), new Decimal(0));
        expect(whole.totals.gross).toBe(sum.toFixed(2));
      }),
    );
  });

  it("'total' scope equals 'unit' scope when the total divides evenly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 0, max: 100_000 }), rate, basis, (n, unitCents, r, b) => {
        const unit = (unitCents / 100).toFixed(2);
        const total = new Decimal(unit).times(n).toFixed(2);
        const a = calculate([{ description: "x", quantity: String(n), amount: unit, amount_scope: "unit", vat_rate: r }], b);
        const t = calculate([{ description: "x", quantity: String(n), amount: total, amount_scope: "total", vat_rate: r }], b);
        expect(t.totals).toEqual(a.totals);
      }),
    );
  });
});
