import { describe, expect, it } from "vitest";
import { add, subtract, multiply, divide, setScale, toPlainString, parseScientific as parse, parseDecimal } from "../src/index";
import type { RoundingMode } from "../src/index";
import { createDecimal, MAX_EXPANSION } from "../src/internal";

describe("parsing boundaries", () => {
  it.each(["1\n", "1\r\n", "1e2\n", "1e2\r\n", "1e2x", "1e 2", "１２"])("rejects %j", input => {
    expect(() => parse(input)).toThrow();
  });
  it("preserves large negative integers and leading zeros", () => {
    expect(parseDecimal("-00012345678901234567890.00")).toEqual({ kind: "big", coefficient: -1234567890123456789000n, scale: 2 });
    expect(parse("000000000000000000001.20")).toEqual(parse("1.20"));
    expect(Object.is(parse("-0.00").coefficient, -0)).toBe(false);
    expect(parse("1e9007199254740991").scale).toBe(-Number.MAX_SAFE_INTEGER);
  });
});

describe("plain formatting", () => {
  it.each(["12.34", "0.0050", "1.20", "-0.0050", "12345678901234567890.00", "0.00"])("round trips %s", input => {
    expect(toPlainString(parse(input))).toBe(input);
  });
  it("handles negative scales and zero", () => {
    expect(toPlainString(parse("1e3"))).toBe("1000");
    expect(toPlainString(parse("-0e9007199254740991"))).toBe("0");
    expect(toPlainString(parse("-12"))).toBe("-12");
  });
  it("checks length before allocating", () => {
    expect(toPlainString(parse("1.20"), 4)).toBe("1.20");
    expect(() => toPlainString(parse("1.20"), 3)).toThrow(RangeError);
    expect(() => toPlainString(parse("1e9007199254740991"))).toThrow(RangeError);
    expect(() => toPlainString(parse("1e-9007199254740991"))).toThrow(RangeError);
    expect(() => toPlainString(parse("1"), Infinity)).toThrow(RangeError);
  });
});

describe("arithmetic", () => {
  it.each([
    ["0.1", "0.2", "0.3"], ["1.20", "0.03", "1.23"],
    ["1.20", "-1.20", "0.00"], ["-1.2", "0.03", "-1.17"],
    ["1e3", "2e2", "1200"], ["999999999999999", "1", "1000000000000000"],
    ["12345678901234567890", "-12345678901234567889", "1"],
    ["999999999999999", "0.01", "999999999999999.01"],
  ])("%s + %s = %s", (a, b, expected) => {
    expect(toPlainString(add(parse(a), parse(b)))).toBe(expected);
  });
  it("subtracts without mutating frozen inputs", () => {
    const a = Object.freeze(parse("1.20")), b = Object.freeze(parse("0.03"));
    expect(toPlainString(subtract(a, b))).toBe("1.17");
    add(a, b); multiply(a, b); divide(a, b, 3, "HALF_UP"); setScale(a, 1, "DOWN");
    expect(a).toEqual(parse("1.20")); expect(b).toEqual(parse("0.03"));
  });
  it.each([
    ["1.20", "0.3", "0.360"], ["-2", "3", "-6"], ["-2", "-3", "6"],
    ["0.00", "-3", "0.00"], ["1e2", "2e3", "200000"],
    ["999999999999999", "999999999999999", "999999999999998000000000000001"],
  ])("%s * %s = %s", (a, b, expected) => {
    expect(toPlainString(multiply(parse(a), parse(b)))).toBe(expected);
  });
  it("normalizes result storage", () => {
    expect(createDecimal(1n, 2).kind).toBe("small");
    expect(createDecimal(-0, 2).coefficient).toBe(0);
    expect(createDecimal(1_000_000_000_000_000, 0).kind).toBe("big");
    expect(() => createDecimal(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow();
    expect(() => createDecimal(1, 0.5)).toThrow();
  });
  it("rejects excessive scale arithmetic and expansion", () => {
    const extreme = parse("1e-9007199254740991");
    expect(() => multiply(extreme, parse("0.1"))).toThrow(RangeError);
    expect(() => add(extreme, parse("1"))).toThrow(RangeError);
    expect(() => add(parse(`1e${MAX_EXPANSION + 1}`), parse("1"))).toThrow(RangeError);
    expect(() => setScale(extreme, -Number.MAX_SAFE_INTEGER, "DOWN")).toThrow(RangeError);
    expect(() => divide(extreme, parse("1"), Number.MIN_SAFE_INTEGER, "DOWN")).toThrow(RangeError);
  });
  it("matches independent BigInt formulas over deterministic random small inputs", () => {
    let seed = 42;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let i = 0; i < 2000; i++) {
      const ac = (random() % 1_000_000_000) * ((random() % 2) ? 1 : -1);
      const bc = (random() % 1_000_000_000) * ((random() % 2) ? 1 : -1);
      const sa = random() % 15 - 7, sb = random() % 15 - 7;
      const a = createDecimal(ac, sa), b = createDecimal(bc, sb), scale = Math.max(sa, sb);
      const left = BigInt(ac) * 10n ** BigInt(scale - sa), right = BigInt(bc) * 10n ** BigInt(scale - sb);
      expect(add(a, b)).toEqual(createDecimal(left + right, scale));
      expect(subtract(a, b)).toEqual(createDecimal(left - right, scale));
      expect(multiply(a, b)).toEqual(createDecimal(BigInt(ac) * BigInt(bc), sa + sb));
    }
  });
});

describe("rounding", () => {
  const cases: [RoundingMode, string[]][] = [
    ["DOWN", ["2", "3", "-2", "-3"]], ["UP", ["3", "4", "-3", "-4"]],
    ["CEILING", ["3", "4", "-2", "-3"]], ["FLOOR", ["2", "3", "-3", "-4"]],
    ["HALF_UP", ["3", "4", "-3", "-4"]], ["HALF_DOWN", ["2", "3", "-2", "-3"]],
    ["HALF_EVEN", ["2", "4", "-2", "-4"]],
  ];
  it.each(cases)("%s handles positive and negative ties", (mode, expected) => {
    ["2.5", "3.5", "-2.5", "-3.5"].forEach((input, i) => {
      expect(toPlainString(setScale(parse(input), 0, mode))).toBe(expected[i]);
    });
  });
  it("handles exact, below/above half, carry, padding and negative scales", () => {
    expect(toPlainString(setScale(parse("1.2"), 3, "UNNECESSARY"))).toBe("1.200");
    expect(toPlainString(setScale(parse("1.200"), 1, "UNNECESSARY"))).toBe("1.2");
    expect(() => setScale(parse("1.21"), 1, "UNNECESSARY")).toThrow();
    expect(toPlainString(setScale(parse("9.995"), 2, "HALF_UP"))).toBe("10.00");
    expect(toPlainString(setScale(parse("-0.04"), 1, "DOWN"))).toBe("0.0");
    expect(toPlainString(setScale(parse("2.49"), 0, "HALF_UP"))).toBe("2");
    expect(toPlainString(setScale(parse("2.51"), 0, "HALF_DOWN"))).toBe("3");
    expect(toPlainString(setScale(parse("2.51"), 0, "HALF_EVEN"))).toBe("3");
    expect(toPlainString(setScale(parse("150"), -2, "HALF_EVEN"))).toBe("200");
  });
});

describe("division", () => {
  it.each([
    ["1", "2", 2, "UNNECESSARY", "0.50"], ["1", "3", 3, "DOWN", "0.333"],
    ["1", "8", 2, "HALF_UP", "0.13"], ["1", "8", 2, "HALF_EVEN", "0.12"],
    ["-1", "8", 2, "FLOOR", "-0.13"], ["1", "-8", 2, "CEILING", "-0.12"],
    ["-1", "-8", 2, "UP", "0.13"], ["150", "1", -2, "HALF_UP", "200"],
    ["1.00", "0.02", 0, "UNNECESSARY", "50"], ["0", "-2", 2, "DOWN", "0.00"],
  ] as const)("%s / %s at scale %s (%s)", (a, b, scale, mode, expected) => {
    expect(toPlainString(divide(parse(a), parse(b), scale, mode))).toBe(expected);
  });
  it("rejects zero divisor and inexact UNNECESSARY", () => {
    expect(() => divide(parse("1"), parse("-0.00"), 2, "DOWN")).toThrow("Division by zero");
    expect(() => divide(parse("1"), parse("3"), 2, "UNNECESSARY")).toThrow();
  });
  it("calculates scale expressions exactly before limiting expansion", () => {
    const value = parse("1e-9007199254740991");
    expect(divide(value, value, 2, "DOWN")).toEqual(parse("1.00"));
  });
});
