# decimal-lab

소수 연산을 직접 구현하며 정확도와 성능을 학습합니다.
정수 coefficient와 scale로 값을 저장하며 파싱, 문자열 출력, 사칙연산과 반올림을 지원합니다.

## 시작

Node.js 24 권장 (최소 22).

```sh
npm install
npm run typecheck
npm test
npm run test:watch
npm run bench
```

`src/index.ts`에서 공개 함수를 가져올 수 있습니다.

```ts
import { parseScientific, add, divide, setScale, toPlainString } from "./src/index";

const a = parseScientific("1.20");
const b = parseScientific("0.03");
toPlainString(add(a, b)); // "1.23"
toPlainString(divide(a, b, 2, "HALF_EVEN")); // "40.00"
toPlainString(setScale(a, 3, "UNNECESSARY")); // "1.200"
```

`subtract(a, b)`, `multiply(a, b)`도 새 결과 객체를 반환합니다.
`setScale(value, scale, mode)`와 `divide(a, b, scale, mode)`는 결과 scale과 반올림 모드를 명시해야 합니다.
모드는 `DOWN`, `UP`, `CEILING`, `FLOOR`, `HALF_UP`, `HALF_DOWN`, `HALF_EVEN`, `UNNECESSARY`입니다.
`UNNECESSARY`에서 나머지가 생기거나 0으로 나누면 오류를 던집니다.

## 구현 순서

1. `parseDecimal`: 부호 → 정수/소수 부분 → 소수 길이로 scale 결정.
2. 앞의 0만 제거. 모든 숫자가 0이면 coefficient는 0, scale은 유지.
3. 정수값이 15자리 이하면 number, 초과하면 문자열에서 바로 BigInt로 변환.
4. `parseScientific`: e/E 분리 → 지수 검사 → scale에서 지수 빼기.
5. 덧셈: scale 정렬과 안전한 정수 범위 검사를 먼저 설계.
6. 반올림 → 곱셈 → 나눗셈 → 실제 입력으로 벤치마크.

## 이번 단계의 규칙

- 값 = coefficient × 10^(-scale).
- small 기준은 보수적으로 15자리 이하. 안전한 16자리 정수도 우선 big입니다.
- `1.20`은 coefficient=120, scale=2로 끝 0을 보존합니다.
- `-0.00`은 coefficient=0, scale=2로 저장합니다.
- 공백을 자동으로 제거하지 않습니다.
- 지수와 scale은 `Number.isSafeInteger` 범위여야 합니다.
- 출력은 부호와 소수점을 포함해 최대 100,000자입니다. `toPlainString(value, maxLength)`로 더 낮출 수 있습니다.
- 정렬·scale 변경·나눗셈에서 생성하는 10의 거듭제곱은 최대 100,000자리까지 허용합니다. 초과하면 `RangeError`를 던집니다.
- 입력 길이와 기존 coefficient 자릿수에는 별도의 한도를 두지 않습니다.
- 연산 중간값도 검사해야 합니다. 입력이 small이라고 결과까지 정확하진 않습니다.

