import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { parseGreekTime } from "../src/intent-parsing/greekTime";
import { parseGreekDate, parseGreekDuration, ZONE } from "../src/intent-parsing/greekDate";

// Wednesday 21 October 2026, Athens.
const TODAY = DateTime.fromISO("2026-10-21", { zone: ZONE }).startOf("day");

describe("parseGreekTime", () => {
  it.each([
    ["πέντε το απόγευμα", "17:00"],
    ["στις 5 το απόγευμα", "17:00"],
    ["17:30", "17:30"],
    ["17.30", "17:30"],
    ["δέκα το πρωί", "10:00"],
    ["δέκα παρά τέταρτο το πρωί", "09:45"],
    ["πέντε και μισή το απόγευμα", "17:30"],
    ["εννιά και είκοσι το πρωί", "09:20"],
    ["οχτώ το βράδυ", "20:00"],
    ["δώδεκα το μεσημέρι", "12:00"],
    ["μία το μεσημέρι", "13:00"],
    ["το μεσημέρι", "12:00"],
    ["τα μεσάνυχτα", "00:00"],
    ["πεντέμισι το απόγευμα", "17:30"],
    ["5 μ.μ.", "17:00"],
    ["9 π.μ.", "09:00"],
    ["στις δεκαεφτά", "17:00"],
    ["δεκαοχτώ και τριάντα", "18:30"],
    ["μία παρά τέταρτο το μεσημέρι", "12:45"],
    ["στις 14:00", "14:00"],
  ])("%s -> %s", (input, expected) => {
    expect(parseGreekTime(input)).toEqual({ kind: "ok", time: expected });
  });

  it.each([
    ["στις 5", ["05:00", "17:00"]],
    ["πέντε", ["05:00", "17:00"]],
    ["στις δώδεκα", ["12:00", "00:00"]],
    ["τέσσερις και τέταρτο", ["04:15", "16:15"]],
  ])("%s is ambiguous", (input, candidates) => {
    expect(parseGreekTime(input)).toEqual({ kind: "ambiguous", candidates });
  });

  it("flags approximate times", () => {
    expect(parseGreekTime("γύρω στις 5").kind).toBe("approximate");
  });

  it.each([["25:00"], ["17 το πρωί"], ["κάποια στιγμή"], ["εννιά το μεσημέρι"], ["10:75"]])("rejects %s", (input) => {
    expect(parseGreekTime(input).kind).toBe("invalid");
  });
});

describe("parseGreekDate", () => {
  it.each([
    ["αύριο", "2026-10-22"],
    ["σήμερα", "2026-10-21"],
    ["μεθαύριο", "2026-10-23"],
    ["την Παρασκευή", "2026-10-23"],
    ["τη Δευτέρα", "2026-10-26"],
    ["αυτή την Κυριακή", "2026-10-25"],
    ["την ερχόμενη Τρίτη", "2026-10-27"],
    ["την Παρασκευή που μας έρχεται", "2026-10-23"],
    ["25 Οκτωβρίου", "2026-10-25"],
    ["στις 3 Νοεμβρίου", "2026-11-03"],
    ["την 1η Δεκεμβρίου", "2026-12-01"],
    ["εικοσιοχτώ Οκτωβρίου", "2026-10-28"],
    ["είκοσι οχτώ Οκτωβρίου", "2026-10-28"],
    ["30/10", "2026-10-30"],
    ["30/10/2026", "2026-10-30"],
    ["σε τρεις μέρες", "2026-10-24"],
    ["σε μια εβδομάδα", "2026-10-28"],
    ["την Παρασκευή 23 Οκτωβρίου", "2026-10-23"],
    ["2026-11-02", "2026-11-02"],
    ["στις 28 του μήνα", "2026-10-28"],
  ])("%s -> %s", (input, expected) => {
    const r = parseGreekDate(input, TODAY);
    if (expected === null) expect(r.kind).toBe("invalid");
    else expect(r).toEqual({ kind: "ok", date: expected });
  });

  it("asks when the weekday is today", () => {
    expect(parseGreekDate("την Τετάρτη", TODAY)).toEqual({ kind: "ambiguous", candidates: ["2026-10-21", "2026-10-28"] });
  });

  it("treats 'την επόμενη Παρασκευή' as ambiguous", () => {
    expect(parseGreekDate("την επόμενη Παρασκευή", TODAY)).toEqual({
      kind: "ambiguous",
      candidates: ["2026-10-23", "2026-10-30"],
    });
  });

  it("assumes next year for a passed day without year and says so", () => {
    expect(parseGreekDate("5 Ιανουαρίου", TODAY)).toEqual({ kind: "ok", date: "2027-01-05", assumedYear: 2027 });
  });

  it("flags explicit past dates for appointments but allows them for queries", () => {
    expect(parseGreekDate("χθες", TODAY)).toEqual({ kind: "past", date: "2026-10-20" });
    expect(parseGreekDate("χθες", TODAY, "any")).toEqual({ kind: "ok", date: "2026-10-20" });
    expect(parseGreekDate("10/10/2026", TODAY).kind).toBe("past");
  });

  it("detects weekday/date conflicts", () => {
    expect(parseGreekDate("την Πέμπτη 23 Οκτωβρίου", TODAY)).toEqual({ kind: "conflict", date: "2026-10-23", weekday: 4 });
  });

  it("returns week ranges", () => {
    expect(parseGreekDate("αυτή την εβδομάδα", TODAY, "any")).toEqual({ kind: "range", start: "2026-10-19", end: "2026-10-25" });
    expect(parseGreekDate("την επόμενη εβδομάδα", TODAY, "any")).toEqual({ kind: "range", start: "2026-10-26", end: "2026-11-01" });
  });

  it.each([["30 Φεβρουαρίου"], ["κάποια μέρα"], ["32/10"]])("rejects %s", (input) => {
    expect(parseGreekDate(input, TODAY).kind).toBe("invalid");
  });
});

describe("parseGreekDuration", () => {
  it.each([
    ["μία ώρα", 60],
    ["μισή ώρα", 30],
    ["45 λεπτά", 45],
    ["ενάμιση ώρα", 90],
    ["δύο ώρες", 120],
    ["1,5 ώρες", 90],
    ["σαράντα πέντε λεπτά", 45],
  ])("%s -> %d", (input, expected) => {
    expect(parseGreekDuration(input)).toBe(expected);
  });

  it("rejects nonsense", () => {
    expect(parseGreekDuration("λίγο")).toBeNull();
  });
});
