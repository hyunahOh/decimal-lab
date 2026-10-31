import Decimal from "decimal.js";

export const groups = ["small-6-digit", "small", "small-promotion", "boundary", "30-digit", "100-digit", "1000-digit"];
export const operationNames = ["construct", "plus", "minus", "times", "div", "mod", "sqrt", "pow3", "round2", "prec10", "cmp", "toString", "toFixed2", "toPrecision10", "toExponential8", "endToEnd"];

export function inputs(group) {
  let seed = 20261031;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const digits = length => Array.from({ length }, (_, i) => String(i === 0 ? random() % 9 + 1 : random() % 10)).join("");
  return Array.from({ length: 32 }, (_, i) => {
    if (group === "small-6-digit") {
      const sign = i % 3 === 0 ? "-" : "";
      return [`${sign}${digits(6)}e-2`, `${i % 5 === 0 ? "-" : ""}${digits(6)}e-2`];
    }
    if (group === "small-promotion") {
      // Both coefficients are small; addition and multiplication promote to big.
      const sign = i % 2 ? "-" : "";
      return [`${sign}${999999999999999n - 10n * BigInt(i)}e-2`, `${sign}${999999999999997n - 10n * BigInt(i)}e-2`];
    }
    const length = group === "small" ? [3, 6, 9, 12][i % 4] : group === "boundary" ? [15, 16][i % 2] : parseInt(group, 10);
    const a = group === "boundary" ? ["999999999999999", "1000000000000000", "1000000000000001", "9999999999999999"][i % 4] : digits(length);
    const b = digits(length);
    return [`${i % 3 === 0 ? "-" : ""}${a}e-${[2, 2, 4, 0, 6, 2, 1, 3][i % 8]}`,
      `${i % 5 === 0 ? "-" : ""}${b}e-${[2, 3, 2, 0][i % 4]}`];
  });
}

export function bigCases(Constructor, pairs) {
  const Big = Constructor(); Big.DP = 20; Big.RM = Big.roundHalfEven;
  const a = pairs.map(pair => Big(pair[0])), b = pairs.map(pair => Big(pair[1]));
  const positive = a.map(value => value.abs());
  return {
    construct: i => Big(pairs[i][0]), plus: i => a[i].plus(b[i]), minus: i => a[i].minus(b[i]),
    times: i => a[i].times(b[i]), div: i => a[i].div(b[i]), mod: i => a[i].mod(b[i]),
    sqrt: i => positive[i].sqrt(), pow3: i => a[i].pow(3), round2: i => a[i].round(2),
    prec10: i => a[i].prec(10), cmp: i => a[i].cmp(b[i]), toString: i => a[i].toString(),
    toFixed2: i => a[i].toFixed(2), toPrecision10: i => a[i].toPrecision(10),
    toExponential8: i => a[i].toExponential(8),
    endToEnd: i => Big(pairs[i][0]).plus(pairs[i][1]).times("1.1").div("3").toFixed(2),
  };
}

export function decimalCases(pairs) {
  const config = { rounding: Decimal.ROUND_HALF_EVEN, modulo: Decimal.ROUND_DOWN, toExpNeg: -7, toExpPos: 21 };
  const raw = pairs.flat().map(value => new Decimal(value));
  const maxDigits = Math.max(...raw.map(value => value.sd()));
  // Enough significant digits for exact +/-/* and cube results, including scale alignment.
  const exactPrecision = 3 * maxDigits + 32;
  const Exact = Decimal.clone({ ...config, precision: exactPrecision });
  const a = pairs.map(pair => Exact(pair[0])), b = pairs.map(pair => Exact(pair[1]));
  const divPrecision = Math.max(1, ...a.map((value, i) => value.e - b[i].e + 1)) + 20 + 10;
  const sqrtPrecision = Math.max(1, ...a.map(value => Math.floor(value.e / 2) + 1)) + 20 + 10;
  const chainPrecision = Math.max(1, ...raw.map(value => value.e + 3)) + 20 + 10;
  const Div = Decimal.clone({ ...config, precision: divPrecision });
  const Sqrt = Decimal.clone({ ...config, precision: sqrtPrecision });
  const Chain = Decimal.clone({ ...config, precision: chainPrecision });
  const division = pairs.map(pair => [Div(pair[0]), Div(pair[1])]);
  const positive = pairs.map(pair => Sqrt(pair[0]).abs());
  return {
    settings: { exactPrecision, divPrecision, sqrtPrecision, chainPrecision, guardDigits: 10 },
    cases: {
      construct: i => Exact(pairs[i][0]), plus: i => a[i].plus(b[i]), minus: i => a[i].minus(b[i]),
      times: i => a[i].times(b[i]),
      div: i => division[i][0].div(division[i][1]).toDP(20),
      mod: i => a[i].mod(b[i]), sqrt: i => positive[i].sqrt().toDP(20), pow3: i => a[i].pow(3),
      round2: i => a[i].toDP(2), prec10: i => a[i].toSD(10), cmp: i => a[i].cmp(b[i]),
      toString: i => a[i].toString(), toFixed2: i => a[i].toFixed(2),
      toPrecision10: i => a[i].toPrecision(10), toExponential8: i => a[i].toExponential(8),
      endToEnd: i => Chain(pairs[i][0]).plus(pairs[i][1]).times("1.1").div("3").toDP(20).toFixed(2),
    },
  };
}
