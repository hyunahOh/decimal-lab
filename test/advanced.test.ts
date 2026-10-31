import { describe, expect, it } from "vitest";
import Reference from "big.js";
import Big from "../src/index";

describe("advanced big.js compatibility", () => {
  it.each(["0", "-0", "1", "2", "4", "6.25", "12.25", "0.0025", "0.0225", "0.000000000000000000000000000001", "1e80", "1e-80", "99999999999999999999999999999999999999"])("sqrt(%s) matches for all rounding modes", input => {
    const Local = Big(), Ref = Reference();
    for (const dp of [0, 1, 2, 20, 40]) for (const rm of [0, 1, 2, 3] as const) {
      Local.DP = Ref.DP = dp; Local.RM = Ref.RM = rm;
      // big.js 7.0.1's Newton loop does not terminate for some tiny values
      // at low DP. Cover those with exact expected values below instead.
      if (Number(input) !== 0 && Math.floor(Math.log10(Math.sqrt(Number(input)))) + dp + 4 < 0) continue;
      expect(Local(input).sqrt().valueOf()).toBe(Ref(input).sqrt().valueOf());
    }
  });

  it("rounds tiny square roots without depending on the reference Newton loop", () => {
    const Local = Big();
    for (const dp of [0, 2, 20]) for (const rm of [0, 1, 2, 3]) {
      Local.DP = dp; Local.RM = rm;
      expect(Local("1e-80").sqrt().toString()).toBe(rm === 3 ? Local(`1e-${dp}`).toString() : "0");
    }
    Local.DP = 40;
    expect(Local("1e-80").sqrt().toString()).toBe("1e-40");
  });

  it("handles square roots beyond floating point range and near half boundaries", () => {
    const Local = Big();
    Local.DP = 0; Local.RM = Local.roundHalfUp;
    expect(Local("1e400").sqrt().toString()).toBe("1e+200");
    expect(Local("6.2499999999999999999999999999999999999999").sqrt().toString()).toBe("2");
    expect(Local("6.2500000000000000000000000000000000000001").sqrt().toString()).toBe("3");
    Local.DP = 200;
    expect(Local("1e-400").sqrt().toString()).toBe("1e-200");
  });

  it("supports arithmetic aliases", () => {
    expect(Big("1").add("2").sub("0.5").mul("4").toString()).toBe("10");
  });

  it.each(["-0", "0", "1", "-1", "1.20", "-2.5", "9.99", "1e20", "1e-20"])("pow(%s, n) matches", input => {
    const Local = Big(), Ref = Reference();
    for (const exponent of [-11, -3, -2, -1, 0, 1, 2, 3, 11]) {
      for (const rm of [0, 1, 2, 3] as const) {
        Local.RM = Ref.RM = rm; Local.DP = Ref.DP = 8;
        if ((input === "0" || input === "-0") && exponent < 0) {
          expect(() => Local(input).pow(exponent)).toThrow();
        } else expect(Local(input).pow(exponent).valueOf()).toBe(Ref(input).pow(exponent).valueOf());
      }
    }
  });

  it("handles exponent boundaries and rejects coefficient growth before oversized products", () => {
    expect(Big("-1").pow(1_000_000).toString()).toBe("1");
    expect(Big("-1").pow(-999_999).toString()).toBe("-1");
    expect(() => Big("2").pow(1_000_000)).toThrow(RangeError);
    expect(() => Big("1e9007199254740991").pow(2)).toThrow(RangeError);
    for (const exponent of [0.5, NaN, Infinity, 1_000_001, -1_000_001]) expect(() => Big("2").pow(exponent)).toThrow();
  });

  it.each(["0", "-0", "1", "-1", "4", "-4", "0.9", "-0.9", "12345678901234567890.1234"])("mod(%s, y) matches", input => {
    const Local = Big(), Ref = Reference();
    // Modulo must ignore division rounding settings and leave them untouched.
    Local.DP = Ref.DP = 1; Local.RM = Ref.RM = 3;
    for (const other of ["2", "-2", "0.3", "-0.3", "1e30", "1e-20"]) {
      expect(Local(input).mod(other).valueOf()).toBe(Ref(input).mod(other).valueOf());
    }
    expect(Local.DP).toBe(1); expect(Local.RM).toBe(3);
  });

  it.each(["0", "-0", "1.2", "-1.2", "9.995", "-9.995", "999.99", "0.0000012345", "1e-7", "1e21", "1e40", "-1e-40"])("precision/exponential output for %s", input => {
    const value = Big(input), reference = Reference(input);
    expect(value.toExponential()).toBe(reference.toExponential());
    expect(value.toPrecision()).toBe(reference.toPrecision());
    for (const sd of [1, 2, 3, 5, 25]) for (const rm of [0, 1, 2, 3] as const) {
      expect(value.prec(sd, rm).valueOf()).toBe(reference.prec(sd, rm).valueOf());
      expect(value.toPrecision(sd, rm)).toBe(reference.toPrecision(sd, rm));
      expect(value.toExponential(sd - 1, rm)).toBe(reference.toExponential(sd - 1, rm));
    }
  });

  it("respects notation thresholds after rounding and suppresses negative zero", () => {
    const Local = Big(), Ref = Reference();
    Local.NE = Ref.NE = -2; Local.PE = Ref.PE = 3;
    for (const input of ["999.9", "0.09999", "0.009999", "1000", "-0"]) {
      for (const sd of [1, 2, 5, 10]) expect(Local(input).toPrecision(sd)).toBe(Ref(input).toPrecision(sd));
    }
    Local.NE = Ref.NE = 0;
    for (const input of ["0", "-0"]) {
      expect(Local(input).toString()).toBe(Ref(input).toString());
      expect(Local(input).valueOf()).toBe(Ref(input).valueOf());
    }
  });

  it("validates arguments and checks output sizes before padding", () => {
    for (const invalid of [0, -1, 1.5, NaN, Infinity, 1_000_001]) {
      expect(() => Big("1").prec(invalid)).toThrow();
      expect(() => Big("1").toPrecision(invalid)).toThrow();
    }
    for (const invalid of [-1, 1.5, NaN, Infinity, 1_000_001]) expect(() => Big("1").toExponential(invalid)).toThrow();
    for (const invalid of [-1, 0.5, 4, NaN]) {
      expect(() => Big("1").prec(2, invalid)).toThrow();
      expect(() => Big("1").toPrecision(2, invalid)).toThrow();
      expect(() => Big("1").toExponential(2, invalid)).toThrow();
    }
    expect(() => Big("-1").sqrt()).toThrow();
    expect(() => Big("1").mod("0")).toThrow();
    expect(() => Big("1").toPrecision(1_000_000)).toThrow(RangeError);
    expect(() => Big("1").toExponential(1_000_000)).toThrow(RangeError);
    expect(() => Big("1e100001").sqrt()).toThrow(RangeError);
    const Local = Big(); Local.DP = -1;
    expect(() => Local("2").sqrt()).toThrow();
    expect(Local("-0").sqrt().valueOf()).toBe("-0");
    expect(Local("2").pow(3).toString()).toBe("8");
    Local.DP = 2; Local.RM = 4;
    expect(() => Local("2").sqrt()).toThrow();
    expect(() => Local("2").pow(-1)).toThrow();
  });

  it("preserves receiver configuration, strict mode, inputs, and chainability", () => {
    const Local = Big(); Local.strict = true; Local.DP = 2;
    const value = Local("2.25"), other = Local("0.2");
    expect(value.sqrt().pow(2).mod(other).prec(2).toPrecision(2)).toBe("0.050");
    expect(value.toString()).toBe("2.25"); expect(other.toString()).toBe("0.2");
    expect(value.sqrt().constructor).toBe(Local);
    expect(() => value.mod(2)).toThrow(TypeError);
    expect(Local.DP).toBe(2);
  });

  it("matches 2,000 deterministic samples across the new methods", () => {
    let seed = 20261031;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const Local = Big(), Ref = Reference();
    for (let i = 0; i < 2000; i++) {
      const a = `${random() + 1}e${random() % 41 - 20}`;
      const b = `${random() + 1}e${random() % 21 - 10}`;
      const rm = (random() % 4) as 0 | 1 | 2 | 3, dp = random() % 25, sd = random() % 25 + 1;
      Local.DP = Ref.DP = dp; Local.RM = Ref.RM = rm;
      const value = Local(a), reference = Ref(a);
      if (Math.floor(Math.log10(Math.sqrt(Number(a)))) + dp + 4 >= 0) {
        expect(value.sqrt().toString()).toBe(reference.sqrt().toString());
      }
      expect(value.mod(b).valueOf()).toBe(reference.mod(b).valueOf());
      expect(value.pow(i % 9 - 4).toString()).toBe(reference.pow(i % 9 - 4).toString());
      expect(value.prec(sd).toString()).toBe(reference.prec(sd).toString());
      expect(value.toPrecision(sd)).toBe(reference.toPrecision(sd));
      expect(value.toExponential(dp)).toBe(reference.toExponential(dp));
    }
  });
});
