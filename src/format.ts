import type { DecimalData } from "./decimal";
import { checkScale } from "./internal";

export const MAX_OUTPUT_LENGTH = 100_000;

/** Plain notation preserving fractional trailing zeros. Limit includes sign and decimal point. */
export function toPlainString(value: DecimalData, maxLength = MAX_OUTPUT_LENGTH): string {
  const scale = checkScale(value.scale);
  if (!Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > MAX_OUTPUT_LENGTH) {
    throw new RangeError(`Output limit must be between 1 and ${MAX_OUTPUT_LENGTH}`);
  }
  const negative = value.coefficient < 0;
  const digits = value.coefficient.toString().replace(/^-/, "");
  const zero = value.coefficient === 0 || value.coefficient === 0n;
  const length = (negative ? 1n : 0n) + (scale <= 0
    ? BigInt(digits.length) + (zero ? 0n : -BigInt(scale))
    : BigInt(Math.max(digits.length, scale + 1)) + 1n);
  if (length > BigInt(maxLength)) throw new RangeError("Plain output exceeds length limit");
  let body: string;
  if (scale <= 0) body = zero ? "0" : digits + "0".repeat(-scale);
  else {
    const padded = digits.padStart(scale + 1, "0");
    body = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
  }
  return (negative ? "-" : "") + body;
}
