import { describe, expect, it } from "vitest";
import Reference from "big.js";
import Big, { Big as NamedBig } from "../src/index";
import type { BigConstructor } from "../src/index";

describe("big.js facade", () => {
  it("supports calls, new, named/default imports, copies and chaining", () => {
    expect(NamedBig).toBe(Big);
    const value = new Big("1.20");
    expect(value).toBeInstanceOf(Big);
    expect(Big(value)).not.toBe(value);
    expect(Big(value).toString()).toBe("1.2");
    expect(value.plus("0.3").times(2).minus("1").div("4").toString()).toBe("0.5");
    expect(value.toString()).toBe("1.2");
    expect(Big(12345678901234567890n).toString()).toBe("12345678901234567890");
  });

  it("creates independent constructors with default configuration", () => {
    const Local = Big(), Other = Local();
    Local.DP = 2;
    Other.DP = 4;
    expect(Local("1").div(3).toString()).toBe("0.33");
    expect(Other("1").div(Local(3)).toString()).toBe("0.3333");
    expect(Big.DP).toBe(20);
    expect(Local("1").constructor).toBe(Local);
    expect(Local.roundDown).toBe(0);
    expect(Local.roundHalfUp).toBe(1);
    expect(Local.roundHalfEven).toBe(2);
    expect(Local.roundUp).toBe(3);
  });

  it.each(["+1", " 1", "1 ", "1\n", "1e2\n", "1\r\n", "0xff", "NaN", "Infinity", "", ".", "1e"])("rejects invalid input %j", input => {
    expect(() => Big(input)).toThrow();
    expect(() => Reference(input)).toThrow();
  });

  it("rejects missing new argument and nonfinite values", () => {
    expect(() => new (Big as unknown as new() => unknown)()).toThrow();
    for (const value of [NaN, Infinity, -Infinity]) expect(() => Big(value)).toThrow();
  });

  it.each(["1.20", "-0.00", "12345678901234567890123456789", "0.0000001", "0.000001", "1e20", "1e21", "-1.2300e30", ".5", "12."])("matches formatting for %s", input => {
    const value = Big(input), reference = Reference(input);
    expect(value.toString()).toBe(reference.toString());
    expect(value.toFixed()).toBe(reference.toFixed());
    expect(value.valueOf()).toBe(reference.valueOf());
    expect(JSON.stringify(value)).toBe(JSON.stringify(reference));
    for (const dp of [0, 1, 2, 8]) for (const rm of [0, 1, 2, 3] as const) {
      expect(value.toFixed(dp, rm)).toBe(reference.toFixed(dp, rm));
    }
  });

  it("uses NE and PE independently for each constructor", () => {
    const Local = Big(), Ref = Reference();
    Local.NE = Ref.NE = -2;
    Local.PE = Ref.PE = 3;
    for (const text of ["0.01", "0.1", "999", "1000", "-1000"]) {
      expect(Local(text).toString()).toBe(Ref(text).toString());
      expect(Local(text).toFixed()).toBe(Ref(text).toFixed());
    }
  });

  it.each(["2.5", "3.5", "-2.5", "-3.5", "9.995", "-9.995"])("matches tie rounding for %s", input => {
    for (const rm of [0, 1, 2, 3] as const) for (const dp of [-1, 0, 2]) {
      expect(Big(input).round(dp, rm).valueOf()).toBe(Reference(input).round(dp, rm).valueOf());
    }
  });

  it("matches negative zero through arithmetic and rounding", () => {
    for (const a of ["0", "-0", "1", "-1", "0.01", "-0.01"]) {
      for (const b of ["0", "-0", "1", "-1"]) {
        for (const method of ["plus", "minus", "times"] as const) {
          expect(Big(a)[method](b).valueOf()).toBe(Reference(a)[method](b).valueOf());
        }
        if (b !== "0" && b !== "-0") expect(Big(a).div(b).valueOf()).toBe(Reference(a).div(b).valueOf());
        expect(Big(a).cmp(b)).toBe(Reference(a).cmp(b));
      }
      expect(Big(a).round(0).valueOf()).toBe(Reference(a).round(0).valueOf());
      expect(Big(a).toFixed(0)).toBe(Reference(a).toFixed(0));
      expect(Big(a).abs().valueOf()).toBe(Reference(a).abs().valueOf());
      expect(Big(a).neg().valueOf()).toBe(Reference(a).neg().valueOf());
    }
    expect(Object.is(Big(-0).toNumber(), -0)).toBe(true);
  });

  it("supports strict construction and conversion", () => {
    const Local = Big(); Local.strict = true;
    expect(() => Local(1)).toThrow(TypeError);
    expect(() => Local("1").plus(2)).toThrow(TypeError);
    expect(Local(1n).toString()).toBe("1");
    expect(Local(Big("1.2")).toString()).toBe("1.2");
    expect(() => Local("1").valueOf()).toThrow();
    expect(Local("1.2").toNumber()).toBe(1.2);
    expect(() => Local("1.00000000000000000001").toNumber()).toThrow();
    expect(() => Local("1e400").toNumber()).toThrow();
    expect(() => Local("1e-400").toNumber()).toThrow();
  });

  it("validates configuration at use and protects allocation limits", () => {
    const Local = Big();
    Local.DP = -1;
    expect(Local("1").plus("2").toString()).toBe("3");
    expect(() => Local("1").div("2")).toThrow();
    Local.DP = 2; Local.RM = 4;
    expect(() => Local("1").div("2")).toThrow();
    expect(() => Local("1").round()).toThrow();
    expect(() => Local("1").toFixed(2)).toThrow();
    expect(() => Big("1").div("0")).toThrow();
    expect(() => Big("1").round(1.5)).toThrow();
    expect(() => Big("1").toFixed(-1)).toThrow();
    expect(() => Big("1").toFixed(100001)).toThrow(RangeError);
    expect(Big("1e100001").toString()).toBe("1e+100001");
    expect(() => Big("1e100001").toFixed()).toThrow(RangeError);
  });

  it("compares extreme exponents without expanding coefficients", () => {
    expect(Big("1e100001").gt("9e100000")).toBe(true);
    expect(Big("-1e100001").lt("-9e100000")).toBe(true);
    expect(Big("1.20").eq("1.2")).toBe(true);
    expect(Big("1.20").gte("1.2")).toBe(true);
    expect(Big("1.20").lte("1.2")).toBe(true);
  });

  it("matches 10,000 deterministic operand pairs", () => {
    const Local = Big(), Ref = Reference();
    let seed = 94821;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const input = () => {
      const digits = `${random()}${random()}`;
      return `${random() & 0x80000000 ? "-" : ""}${digits}e${random() % 31 - 15}`;
    };
    for (let i = 0; i < 10_000; i++) {
      const a = input(), b = input(), rm = (i % 4) as 0 | 1 | 2 | 3, dp = i % 21;
      Local.DP = Ref.DP = dp; Local.RM = Ref.RM = rm;
      const x = Local(a), y = Ref(a);
      for (const method of ["plus", "minus", "times", "div"] as const) {
        expect(x[method](b).toString()).toBe(y[method](b).toString());
      }
      expect(x.cmp(b)).toBe(y.cmp(b));
      expect(x.toFixed(dp, rm)).toBe(y.toFixed(dp, rm));
      expect(x.round(dp - 10, rm).valueOf()).toBe(y.round(dp - 10, rm).valueOf());
    }
  });

  it("matches mixed 1–30 digit inputs across promotion, cancellation and scale alignment", () => {
    let seed = 31791;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const input = () => {
      const length = random() % 30 + 1;
      let digits = String(random() % 9 + 1);
      for (let i = 1; i < length; i++) digits += String(random() % 10);
      return `${random() & 0x80000000 ? "-" : ""}${digits}e-${random() % 31}`;
    };
    for (let i = 0; i < 3000; i++) {
      const a = input(), b = i % 5 === 0 ? a.replace(/^-?/, a[0] === "-" ? "" : "-") : input();
      const x = Big(a), y = Big(b);
      Object.freeze(x); Object.freeze(y);
      const reference = Reference(a);
      for (const method of ["plus", "minus", "times"] as const) {
        expect(x[method](y).valueOf()).toBe(reference[method](b).valueOf());
      }
      expect(x.cmp(y)).toBe(reference.cmp(b));
      expect(x.toFixed(i % 10)).toBe(reference.toFixed(i % 10));
      expect(x.valueOf()).toBe(reference.valueOf());
      expect(y.valueOf()).toBe(Reference(b).valueOf());
    }
  });

  it("preserves exact extreme exponents while bounding plain output", () => {
    const value = Big("123e9007199254740991");
    expect(value.toString()).toBe("1.23e+9007199254740993");
    expect(value.toExponential(2)).toBe("1.23e+9007199254740993");
    expect(() => value.toFixed()).toThrow(RangeError);
    expect(Big("1").toFixed(99_998).length).toBe(100_000);
    expect(() => Big("-1").toFixed(99_998)).toThrow(RangeError);
    expect(Big("-0.0001").toFixed(2)).toBe("-0.00");
  });
});

// Compile-time coverage of callable/newable constructors and chain result types.
const constructor: BigConstructor = Big;
const typedValue: Big = constructor("1");
const typedConfig: number = typedValue.constructor.DP;
const typedResult: string = new constructor("1").plus(constructor("2")).toFixed(2);
void typedConfig;
void typedResult;
