import { describe, expect, it } from "vitest";
import { parseDecimal, parseScientific } from "../src/parse";

describe("parseDecimal", () => {
  it("12.34", () => { expect(parseDecimal("12.34")).toEqual({ kind: "small", coefficient: 1234, scale: 2 }); });
  it("-0.0050", () => { expect(parseDecimal("-0.0050")).toEqual({ kind: "small", coefficient: -50, scale: 4 }); });
  it("0.00", () => { expect(parseDecimal("0.00")).toEqual({ kind: "small", coefficient: 0, scale: 2 }); });
  it("-0.00", () => { expect(parseDecimal("-0.00")).toEqual({ kind: "small", coefficient: 0, scale: 2 }); });
  it(".5", () => { expect(parseDecimal(".5")).toEqual({ kind: "small", coefficient: 5, scale: 1 }); });
  it("12.", () => { expect(parseDecimal("12.")).toEqual({ kind: "small", coefficient: 12, scale: 0 }); });
  it("+12.00", () => { expect(parseDecimal("+12.00")).toEqual({ kind: "small", coefficient: 1200, scale: 2 }); });
  it("000.0050", () => { expect(parseDecimal("000.0050")).toEqual({ kind: "small", coefficient: 50, scale: 4 }); });
  it("999999999999999", () => { expect(parseDecimal("999999999999999")).toEqual({ kind: "small", coefficient: 999999999999999, scale: 0 }); });
  it("큰 정수를 정확히 보존", () => { expect(parseDecimal("1234567890123456.78")).toEqual({ kind: "big", coefficient: 123456789012345678n, scale: 2 }); });
  it("16자리 경계는 big", () => { expect(parseDecimal("1000000000000000")).toEqual({ kind: "big", coefficient: 1000000000000000n, scale: 0 }); });
  it.each(["", " ", " 1", "1 ", "+", "-", ".", "1.2.3", "0xff", "NaN", "Infinity", "1e3", "1_000"])("잘못된 입력 %j를 거부", (input) => { expect(() => parseDecimal(input)).toThrow(); });
});

describe("parseScientific", () => {
  it("1.23e4", () => { expect(parseScientific("1.23e4")).toEqual({ kind: "small", coefficient: 123, scale: -2 }); });
  it("1.23e-4", () => { expect(parseScientific("1.23e-4")).toEqual({ kind: "small", coefficient: 123, scale: 6 }); });
  it("1.20E+1", () => { expect(parseScientific("1.20E+1")).toEqual({ kind: "small", coefficient: 120, scale: 1 }); });
  it("1e100", () => { expect(parseScientific("1e100")).toEqual({ kind: "small", coefficient: 1, scale: -100 }); });
  it("12.34", () => { expect(parseScientific("12.34")).toEqual({ kind: "small", coefficient: 1234, scale: 2 }); });
  it("-0.00e3", () => { expect(parseScientific("-0.00e3")).toEqual({ kind: "small", coefficient: 0, scale: -1 }); });
  it.each(["1e", "1e+", "1e2e3", "1e1.5", "e3", "1e9007199254740992", "1.0e-9007199254740991"])("잘못된 지수 입력 %j를 거부", (input) => { expect(() => parseScientific(input)).toThrow(); });
});
