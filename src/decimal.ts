/** 값 = coefficient × 10^(-scale). small은 정수값 절댓값이 10^15 미만. */
export type DecimalData =
  | { readonly kind: "small"; readonly coefficient: number; readonly scale: number }
  | { readonly kind: "big"; readonly coefficient: bigint; readonly scale: number };
