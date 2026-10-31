import type { DecimalData } from "./decimal";
import { checkedScale, createDecimal, MAX_EXPANSION, powerOfTen } from "./internal";

/** Integer Newton iteration; no floating point approximation of the input. */
function integerSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (estimate + value / estimate) / 2n;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}

export function squareRoot(value: DecimalData, dp: number, rm: number): DecimalData {
  let numerator = BigInt(value.coefficient), denominator = 1n;
  const exponent = 2n * BigInt(dp) - BigInt(value.scale);
  if (exponent >= 0n) numerator *= powerOfTen(exponent);
  else denominator = powerOfTen(-exponent);
  let root = integerSqrt(numerator / denominator);
  const exact = root * root * denominator === numerator;
  // Compare sqrt(numerator / denominator) against root + 1/2 exactly.
  const midpoint = denominator * (2n * root + 1n) ** 2n;
  if (!exact && (rm === 3 || ((rm === 1 || rm === 2)
    && (4n * numerator > midpoint || (4n * numerator === midpoint && (rm === 1 || root % 2n !== 0n)))))) root++;
  return createDecimal(root, dp);
}

export function remainder(a: DecimalData, b: DecimalData): DecimalData {
  const scale = Math.max(a.scale, b.scale);
  const left = BigInt(a.coefficient) * powerOfTen(BigInt(scale) - BigInt(a.scale));
  const right = BigInt(b.coefficient) * powerOfTen(BigInt(scale) - BigInt(b.scale));
  return createDecimal(left % right, scale);
}

/** Enforce the coefficient budget before allocating a power's growing products. */
export function powerProduct(a: DecimalData, b: DecimalData): DecimalData {
  const left = BigInt(a.coefficient), right = BigInt(b.coefficient);
  const length = (n: bigint) => n.toString().replace(/^-/, "").length;
  if (left !== 0n && right !== 0n && length(left) + length(right) - 1 > MAX_EXPANSION) {
    throw new RangeError("Power coefficient exceeds digit limit");
  }
  const scale = checkedScale(BigInt(a.scale) + BigInt(b.scale));
  const coefficient = left * right;
  if (length(coefficient) > MAX_EXPANSION) throw new RangeError("Power coefficient exceeds digit limit");
  return createDecimal(coefficient, scale);
}
