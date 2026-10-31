import type { DecimalData } from "./decimal";
import type { RoundingMode } from "./arithmetic";
import { add, divide, multiply, setScale } from "./arithmetic";
import { MAX_OUTPUT_LENGTH } from "./format";
import { checkScale, createDecimal, NUMBER_POWERS_OF_TEN, powerOfTen } from "./internal";
import { powerProduct, remainder, squareRoot } from "./advanced";

export type BigSource = string | number | bigint | BigValue;
export type BigRoundingMode = 0 | 1 | 2 | 3;
export type Big = BigValue;

export interface BigConstructor {
  (value: BigSource): BigValue;
  (): BigConstructor;
  new(value: BigSource): BigValue;
  readonly prototype: BigValue;
  DP: number;
  RM: number;
  NE: number;
  PE: number;
  strict: boolean;
  readonly roundDown: 0;
  readonly roundHalfUp: 1;
  readonly roundHalfEven: 2;
  readonly roundUp: 3;
}

function decimalPlaces(value: number, negative = false): number {
  if (!Number.isInteger(value) || value < (negative ? -1_000_000 : 0) || value > 1_000_000) {
    throw new RangeError("Invalid decimal places");
  }
  return value;
}

function rounding(value: number): RoundingMode {
  const modes: RoundingMode[] = ["DOWN", "HALF_UP", "HALF_EVEN", "UP"];
  if (!Number.isInteger(value) || value < 0 || value > 3) throw new RangeError("Invalid rounding mode");
  return modes[value]!;
}

function normalize(value: DecimalData): DecimalData {
  let scale = value.scale;
  if (value.kind === "small") {
    let coefficient = value.coefficient;
    if (coefficient === 0) return { kind: "small", coefficient: 0, scale: 0 };
    if (coefficient % 10 !== 0) return value;
    do { coefficient /= 10; scale--; } while (coefficient % 10 === 0);
    return { kind: "small", coefficient, scale: checkScale(scale) };
  }
  if (value.coefficient === 0n) return createDecimal(0, 0);
  if (value.coefficient % 10n !== 0n) return value;
  const text = value.coefficient.toString();
  let end = text.length;
  while (text.charCodeAt(end - 1) === 48) end--;
  return createDecimal(BigInt(text.slice(0, end)), checkScale(scale - (text.length - end)));
}

function precision(sd: number): number {
  if (!Number.isInteger(sd) || sd < 1 || sd > 1_000_000) throw new RangeError("Invalid precision");
  return sd;
}

/** Calculate output size before padding or expanding a decimal exponent. */
function formatDigits(digits: string, exponent: number | bigint, scientific: boolean, negative: boolean, width = digits.length): string {
  const size = Math.max(width, digits.length);
  const exponentText = scientific ? `${exponent >= 0 ? "+" : ""}${exponent}` : "";
  // A plain output that passes this bound necessarily has a small, exact
  // exponent. Huge exponents are rejected even if Number conversion rounds.
  const numericExponent = Number(exponent);
  const length = (negative ? 1 : 0) + (scientific
    ? size + (size > 1 ? 1 : 0) + 1 + exponentText.length
    : numericExponent < 0 ? 1 - numericExponent + size
    : numericExponent + 1 >= size ? numericExponent + 1 : size + 1);
  if (length > MAX_OUTPUT_LENGTH) throw new RangeError("Output exceeds length limit");
  digits = digits.padEnd(width, "0");
  let text: string;
  if (scientific) text = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${exponentText}`;
  else if (numericExponent < 0) text = `0.${"0".repeat(-numericExponent - 1)}${digits}`;
  else {
    const point = numericExponent + 1;
    text = point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return (negative ? "-" : "") + text;
}

function decimalExponent(digits: string, scale: number, zero: boolean): number | bigint {
  if (zero) return 0;
  const exponent = digits.length - 1 - scale;
  return Number.isSafeInteger(exponent) ? exponent : BigInt(digits.length - 1) - BigInt(scale);
}

/** Immutable big.js-style facade over the coefficient/scale arithmetic. */
export class BigValue {
  private readonly data: DecimalData;
  private readonly negative: boolean;
  private readonly context: BigConstructor;

  constructor(value: DecimalData, negative: boolean, context: BigConstructor, normalized = false) {
    this.data = normalized ? value : normalize(value);
    this.negative = negative;
    this.context = context;
    (this as { constructor: BigConstructor }).constructor = context;
  }

  private get zero(): boolean { return this.data.coefficient === 0 || this.data.coefficient === 0n; }
  private get digits(): string {
    const text = this.data.coefficient.toString();
    return text[0] === "-" ? text.slice(1) : text;
  }
  private result(value: DecimalData, negative = value.coefficient < 0, normalized = false): BigValue {
    return new BigValue(value, negative, this.context, normalized);
  }

  private operand(value: BigSource): BigValue {
    return value instanceof BigValue ? value : this.context(value);
  }

  plus(value: BigSource): BigValue {
    const other = this.operand(value);
    const result = add(this.data, other.data);
    return this.result(result, result.coefficient < 0 || (this.zero && other.zero && this.negative && other.negative));
  }

  minus(value: BigSource): BigValue {
    const other = this.operand(value);
    const data = add(this.data, createDecimal(-other.data.coefficient, other.data.scale));
    return this.result(data, data.coefficient < 0 || (this.zero && other.zero && this.negative && !other.negative));
  }
  add(value: BigSource): BigValue { return this.plus(value); }
  sub(value: BigSource): BigValue { return this.minus(value); }
  mul(value: BigSource): BigValue { return this.times(value); }

  times(value: BigSource): BigValue {
    const other = this.operand(value);
    return this.result(multiply(this.data, other.data), this.negative !== other.negative);
  }

  div(value: BigSource): BigValue {
    const other = this.operand(value);
    const dp = decimalPlaces(this.context.DP);
    const mode = rounding(this.context.RM);
    return this.result(divide(this.data, other.data, dp, mode), this.negative !== other.negative);
  }

  mod(value: BigSource): BigValue {
    const other = this.operand(value);
    if (other.zero) throw new RangeError("Division by zero");
    if (this.abs().lt(other.abs())) return this.result(this.data, this.negative);
    // Exact multiples produce positive zero, as subtraction does in big.js.
    const data = remainder(this.data, other.data);
    return this.result(data);
  }

  pow(exponent: number): BigValue {
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 1_000_000) throw new RangeError("Invalid exponent");
    let count = Math.abs(exponent);
    let result = this.context("1");
    let base: BigValue = this;
    while (count > 0) {
      if (count % 2 === 1) result = this.result(powerProduct(result.data, base.data), result.negative !== base.negative);
      count = Math.floor(count / 2);
      if (count > 0) base = this.result(powerProduct(base.data, base.data), false);
    }
    return exponent < 0 ? this.context("1").div(result) : result;
  }

  sqrt(): BigValue {
    if (this.zero) return this.result(this.data, this.negative);
    if (this.negative) throw new RangeError("No square root");
    const dp = decimalPlaces(this.context.DP);
    rounding(this.context.RM);
    return this.result(squareRoot(this.data, dp, this.context.RM));
  }

  prec(sd: number, rm = this.context.RM): BigValue {
    precision(sd);
    return this.roundSignificant(sd, rm);
  }

  private roundSignificant(sd: number, rm: number): BigValue {
    const mode = rounding(rm);
    const length = this.digits.length;
    if (this.zero || sd >= length) return this.result(this.data, this.negative, true);
    const scale = checkScale(this.data.scale - (length - sd));
    return this.result(setScale(this.data, scale, mode), this.negative);
  }

  round(dp = 0, rm = this.context.RM): BigValue {
    decimalPlaces(dp, true);
    const mode = rounding(rm);
    // round specifies a maximum number of places; it does not append zeros.
    return dp >= this.data.scale ? this.result(this.data, this.negative, true)
      : this.result(setScale(this.data, dp, mode), this.negative);
  }

  abs(): BigValue { return this.negative ? this.neg() : this.result(this.data, false); }
  neg(): BigValue { return this.result(createDecimal(-this.data.coefficient, this.data.scale), !this.negative); }

  cmp(value: BigSource): -1 | 0 | 1 {
    const other = this.operand(value);
    const aValue = this.data.coefficient, bValue = other.data.coefficient;
    if (this.data.scale === other.data.scale) return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    const difference = this.data.scale - other.data.scale;
    if (Math.abs(difference) <= 30) {
      if (this.data.kind === "small" && other.data.kind === "small" && Math.abs(difference) <= 15) {
        const left = this.data.coefficient * (difference < 0 ? NUMBER_POWERS_OF_TEN[-difference]! : 1);
        const right = other.data.coefficient * (difference > 0 ? NUMBER_POWERS_OF_TEN[difference]! : 1);
        if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) return left < right ? -1 : left > right ? 1 : 0;
      }
      const left = BigInt(aValue) * (difference < 0 ? powerOfTen(BigInt(-difference)) : 1n);
      const right = BigInt(bValue) * (difference > 0 ? powerOfTen(BigInt(difference)) : 1n);
      return left < right ? -1 : left > right ? 1 : 0;
    }
    if (this.zero && other.zero) return 0;
    if (this.negative !== other.negative) return this.negative ? -1 : 1;
    let magnitude: -1 | 0 | 1;
    if (this.zero || other.zero) magnitude = this.zero ? -1 : 1;
    else {
      const a = this.data.coefficient.toString().replace(/^-/, "");
      const b = other.data.coefficient.toString().replace(/^-/, "");
      const ae = BigInt(a.length) - BigInt(this.data.scale);
      const be = BigInt(b.length) - BigInt(other.data.scale);
      if (ae !== be) magnitude = ae < be ? -1 : 1;
      else {
        const width = Math.max(a.length, b.length);
        const left = a.padEnd(width, "0"), right = b.padEnd(width, "0");
        magnitude = left === right ? 0 : left < right ? -1 : 1;
      }
    }
    return magnitude === 0 ? 0 : this.negative ? (magnitude === 1 ? -1 : 1) : magnitude;
  }

  eq(value: BigSource): boolean { return this.cmp(value) === 0; }
  gt(value: BigSource): boolean { return this.cmp(value) > 0; }
  gte(value: BigSource): boolean { return this.cmp(value) >= 0; }
  lt(value: BigSource): boolean { return this.cmp(value) < 0; }
  lte(value: BigSource): boolean { return this.cmp(value) <= 0; }

  toString(): string {
    const digits = this.digits;
    const exponent = decimalExponent(digits, this.data.scale, this.zero);
    return formatDigits(digits, exponent, exponent <= this.context.NE || exponent >= this.context.PE, this.negative && !this.zero);
  }

  toExponential(dp?: number, rm = this.context.RM): string {
    if (dp !== undefined) decimalPlaces(dp);
    const rounded = dp === undefined ? this : this.roundSignificant(dp + 1, rm);
    const digits = rounded.digits;
    return formatDigits(digits, decimalExponent(digits, rounded.data.scale, rounded.zero), true, this.negative && !this.zero,
      dp === undefined ? digits.length : dp + 1);
  }

  toPrecision(sd?: number, rm = this.context.RM): string {
    if (sd === undefined) return this.toString();
    precision(sd);
    const rounded = this.roundSignificant(sd, rm);
    const digits = rounded.digits;
    const exponent = decimalExponent(digits, rounded.data.scale, rounded.zero);
    const scientific = exponent >= sd || exponent <= this.context.NE || exponent >= this.context.PE;
    return formatDigits(digits, exponent, scientific, this.negative && !this.zero, sd);
  }

  toFixed(dp?: number, rm = this.context.RM): string {
    if (dp !== undefined) decimalPlaces(dp);
    const rounded = dp === undefined ? this : this.round(dp, rm);
    const digits = rounded.digits;
    const exponent = decimalExponent(digits, rounded.data.scale, rounded.zero);
    const width = dp === undefined ? digits.length : Math.max(1, Number(exponent) + dp + 1);
    return formatDigits(digits, exponent, false, this.negative && !this.zero, width);
  }

  toJSON(): string { return this.toString(); }

  valueOf(): string {
    if (this.context.strict === true) throw new TypeError("valueOf disallowed in strict mode");
    return this.zero && this.negative ? `-${this.toString()}` : this.toString();
  }

  toNumber(): number {
    const value = this.zero && this.negative ? -0 : Number(this.toString());
    if (this.context.strict === true && (!Number.isFinite(value) || !this.eq(String(value)))) {
      throw new Error("Imprecise conversion");
    }
    return value;
  }

  /** Used by constructors to copy values without parsing or losing negative zero. */
  static copy(value: BigValue, context: BigConstructor): BigValue {
    return new BigValue(value.data, value.negative, context, true);
  }
}

export interface BigValue {
  readonly constructor: BigConstructor;
}

function createBigConstructor(): BigConstructor {
  const factory = function(this: unknown, value?: BigSource): BigValue | BigConstructor {
    if (!new.target && arguments.length === 0) return createBigConstructor();
    if (value instanceof BigValue) return BigValue.copy(value, Big);
    if (Big.strict === true && typeof value !== "string" && typeof value !== "bigint") {
      throw new TypeError("Invalid value");
    }
    const text = typeof value === "number" && Object.is(value, -0) ? "-0" : String(value);
    // big.js does not accept a leading plus sign.
    const match = /^(-?)([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e([+-]?[0-9]+))?(?![\s\S])/i.exec(text);
    if (!match) throw new Error("Invalid number");
    const mantissa = match[2]!;
    const point = mantissa.indexOf(".");
    let scale = point < 0 ? 0 : mantissa.length - point - 1;
    if (match[3] !== undefined) scale = checkScale(scale - checkScale(Number(match[3])));
    const digits = point < 0 ? mantissa : mantissa.slice(0, point) + mantissa.slice(point + 1);
    let start = 0, end = digits.length;
    while (start < end && digits.charCodeAt(start) === 48) start++;
    const negative = match[1] === "-";
    if (start === end) return new BigValue({ kind: "small", coefficient: 0, scale: 0 }, negative, Big, true);
    while (digits.charCodeAt(end - 1) === 48) end--;
    scale = checkScale(scale - (digits.length - end));
    const significant = digits.slice(start, end);
    const signed = negative ? `-${significant}` : significant;
    const data = createDecimal(significant.length <= 15 ? Number(signed) : BigInt(signed), scale);
    return new BigValue(data, negative, Big, true);
  };
  const Big = factory as BigConstructor;
  Object.assign(Big, { DP: 20, RM: 1, NE: -7, PE: 21, strict: false,
    roundDown: 0, roundHalfUp: 1, roundHalfEven: 2, roundUp: 3 });
  Object.defineProperty(Big, "prototype", { value: BigValue.prototype });
  return Big;
}

export const Big = createBigConstructor();
export { Big as default };
