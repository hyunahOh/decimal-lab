import type { DecimalData } from "./decimal";

export const SMALL_LIMIT = 1_000_000_000_000_000;
/** Maximum decimal places expanded by an operation. */
export const MAX_EXPANSION = 100_000;

export function checkScale(scale: number): number {
  if (!Number.isSafeInteger(scale)) throw new RangeError("Scale must be a safe integer");
  return scale === 0 ? 0 : scale;
}

export function checkedScale(scale: bigint): number {
  return checkScale(Number(scale));
}

export function createDecimal(coefficient: number | bigint, scale: number): DecimalData {
  scale = checkScale(scale);
  if (typeof coefficient === "number") {
    if (!Number.isSafeInteger(coefficient)) throw new RangeError("Coefficient must be an exact integer");
    if (Math.abs(coefficient) < SMALL_LIMIT) {
      return { kind: "small", coefficient: coefficient === 0 ? 0 : coefficient, scale };
    }
    coefficient = BigInt(coefficient);
  }
  if (coefficient > -BigInt(SMALL_LIMIT) && coefficient < BigInt(SMALL_LIMIT)) {
    return { kind: "small", coefficient: Number(coefficient), scale };
  }
  return { kind: "big", coefficient, scale };
}

export function powerOfTen(exponent: bigint): bigint {
  if (exponent < 0n || exponent > BigInt(MAX_EXPANSION)) {
    throw new RangeError(`Decimal expansion exceeds ${MAX_EXPANSION} places`);
  }
  return 10n ** exponent;
}
