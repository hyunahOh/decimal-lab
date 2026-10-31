import type { DecimalData } from "./decimal";
import { checkScale, createDecimal } from "./internal";

/** 일반 소수: 부호, .5, 12. 허용. 끝 0과 scale 보존, 음수 0은 양수로 저장. */
export function parseDecimal(input: string): DecimalData {
  if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?![\s\S])/.test(input)) {
    throw new SyntaxError("Invalid decimal");
  }
  const negative = input[0] === "-";
  const unsigned = /^[+-]/.test(input) ? input.slice(1) : input;
  const [integer = "", fraction = ""] = unsigned.split(".");
  const digits = (integer + fraction).replace(/^0+/, "") || "0";
  const signed = negative && digits !== "0" ? `-${digits}` : digits;
  return createDecimal(digits.length <= 15 ? Number(signed) : BigInt(signed), fraction.length);
}

/** 일반 소수와 e/E 지수 표기. 지수와 최종 scale은 안전한 정수여야 합니다. */
export function parseScientific(input: string): DecimalData {
  const parts = input.split(/[eE]/);
  const value = parseDecimal(parts[0]!);
  if (parts.length === 1) return value;
  const exponentText = parts[1]!;
  if (parts.length !== 2 || !/^[+-]?[0-9]+(?![\s\S])/.test(exponentText)) {
    throw new SyntaxError("Invalid exponent");
  }
  const exponent = checkScale(Number(exponentText));
  return { ...value, scale: checkScale(value.scale - exponent) };
}
