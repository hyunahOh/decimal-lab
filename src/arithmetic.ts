import type { DecimalData } from "./decimal";
import { checkedScale, checkScale, createDecimal, powerOfTen } from "./internal";

export type RoundingMode = "DOWN" | "UP" | "CEILING" | "FLOOR" | "HALF_UP" | "HALF_DOWN" | "HALF_EVEN" | "UNNECESSARY";

function roundedDivide(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (!["DOWN", "UP", "CEILING", "FLOOR", "HALF_UP", "HALF_DOWN", "HALF_EVEN", "UNNECESSARY"].includes(mode)) {
    throw new RangeError("Unknown rounding mode");
  }
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  if (mode === "UNNECESSARY") throw new RangeError("Rounding is necessary");
  const sign = numerator < 0n ? -1n : 1n;
  const twice = 2n * (remainder < 0n ? -remainder : remainder);
  const increment = mode === "UP" || (mode === "CEILING" && sign > 0n)
    || (mode === "FLOOR" && sign < 0n)
    || (mode === "HALF_UP" && twice >= denominator)
    || (mode === "HALF_DOWN" && twice > denominator)
    || (mode === "HALF_EVEN" && (twice > denominator || (twice === denominator && quotient % 2n !== 0n)));
  return increment ? quotient + sign : quotient;
}

export function add(a: DecimalData, b: DecimalData): DecimalData {
  checkScale(a.scale); checkScale(b.scale);
  const scale = Math.max(a.scale, b.scale);
  const da = BigInt(scale) - BigInt(a.scale);
  const db = BigInt(scale) - BigInt(b.scale);
  // Check expansion even when a small fast path might be possible.
  const pa = powerOfTen(da);
  const pb = powerOfTen(db);
  if (a.kind === "small" && b.kind === "small" && da <= 15n && db <= 15n) {
    const fa = Number(pa), fb = Number(pb);
    if (Math.abs(a.coefficient) <= Math.floor(Number.MAX_SAFE_INTEGER / fa)
      && Math.abs(b.coefficient) <= Math.floor(Number.MAX_SAFE_INTEGER / fb)) {
      const left = a.coefficient * fa, right = b.coefficient * fb;
      if (Math.abs(left) <= Number.MAX_SAFE_INTEGER - Math.abs(right)) {
        return createDecimal(left + right, scale);
      }
    }
  }
  return createDecimal(BigInt(a.coefficient) * pa + BigInt(b.coefficient) * pb, scale);
}

export function subtract(a: DecimalData, b: DecimalData): DecimalData {
  return add(a, createDecimal(-b.coefficient, b.scale));
}

export function multiply(a: DecimalData, b: DecimalData): DecimalData {
  checkScale(a.scale); checkScale(b.scale);
  const scale = checkedScale(BigInt(a.scale) + BigInt(b.scale));
  if (a.kind === "small" && b.kind === "small"
    && (b.coefficient === 0 || Math.abs(a.coefficient) <= Math.floor(Number.MAX_SAFE_INTEGER / Math.abs(b.coefficient)))) {
    return createDecimal(a.coefficient * b.coefficient, scale);
  }
  return createDecimal(BigInt(a.coefficient) * BigInt(b.coefficient), scale);
}

export function setScale(value: DecimalData, targetScale: number, mode: RoundingMode): DecimalData {
  checkScale(value.scale); checkScale(targetScale);
  const difference = BigInt(targetScale) - BigInt(value.scale);
  const coefficient = BigInt(value.coefficient);
  if (difference > 0n) return createDecimal(coefficient * powerOfTen(difference), targetScale);
  return createDecimal(roundedDivide(coefficient, powerOfTen(-difference), mode), targetScale);
}

export function divide(a: DecimalData, b: DecimalData, scale: number, mode: RoundingMode): DecimalData {
  checkScale(a.scale); checkScale(b.scale); checkScale(scale);
  let numerator = BigInt(a.coefficient), denominator = BigInt(b.coefficient);
  if (denominator === 0n) throw new RangeError("Division by zero");
  const exponent = BigInt(scale) + BigInt(b.scale) - BigInt(a.scale);
  if (exponent >= 0n) numerator *= powerOfTen(exponent);
  else denominator *= powerOfTen(-exponent);
  return createDecimal(roundedDivide(numerator, denominator, mode), scale);
}
