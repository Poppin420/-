import { describe, expect, it } from "vitest";
import { parseGreekDecimal, parseGreekInteger } from "../src/intent-parsing/greekNumbers";
import { parseMoney } from "../src/intent-parsing/greekMoney";

describe("parseGreekInteger", () => {
  it.each([
    ["ογδόντα", 80],
    ["πέντε", 5],
    ["δεκαπέντε", 15],
    ["δεκαεφτά", 17],
    ["είκοσι πέντε", 25],
    ["εκατό", 100],
    ["εκατόν είκοσι πέντε", 125],
    ["διακόσια πενήντα", 250],
    ["τριακόσιες", 300],
    ["χίλια", 1000],
    ["χίλια διακόσια", 1200],
    ["δύο χιλιάδες πεντακόσια", 2500],
    ["μία", 1],
    ["τρεις", 3],
    ["120", 120],
    ["τριανταπέντε", 35],
  ])("%s -> %d", (input, expected) => {
    expect(parseGreekInteger(input)).toBe(expected);
  });

  it.each([["ογδόντα πενήντα"], ["πέντε είκοσι"], ["εκατό εκατό"], ["κάτι"], [""], ["χιλιάδες"]])(
    "rejects %s",
    (input) => {
      expect(parseGreekInteger(input)).toBeNull();
    },
  );
});

describe("parseGreekDecimal", () => {
  it.each([
    ["1.200,50", "1200.5"],
    ["80,5", "80.5"],
    ["80.50", "80.5"],
    ["1.200", "1200"],
    ["ενάμιση", "1.5"],
    ["0080", "80"],
  ])("%s -> %s", (input, expected) => {
    expect(parseGreekDecimal(input)).toBe(expected);
  });
});

describe("parseMoney", () => {
  it.each([
    ["ογδόντα ευρώ", "80.00"],
    ["80€", "80.00"],
    ["€80", "80.00"],
    ["80 ευρώ", "80.00"],
    ["80,50 €", "80.50"],
    ["1.200,50€", "1200.50"],
    ["εκατόν είκοσι ευρώ", "120.00"],
    ["ογδόντα ευρώ και πενήντα λεπτά", "80.50"],
    ["80 ευρώ και 5 λεπτά", "80.05"],
    ["χίλια διακόσια ευρώ", "1200.00"],
    ["σαράντα πέντε", "45.00"],
    ["ΕΚΑΤΟ ΕΥΡΩ", "100.00"],
  ])("%s -> %s", (input, expected) => {
    expect(parseMoney(input)).toEqual({ kind: "ok", amount: expected });
  });

  it.each([["περίπου 80 ευρώ"], ["γύρω στα πενήντα"]])("flags approximate %s", (input) => {
    expect(parseMoney(input).kind).toBe("approximate");
  });

  it.each([["ογδόντα πενήντα"], ["80 ευρώ και 150 λεπτά"], ["80,555"], ["ευρώ"], ["πολλά λεφτά"]])(
    "rejects %s",
    (input) => {
      expect(parseMoney(input).kind).toBe("invalid");
    },
  );
});
