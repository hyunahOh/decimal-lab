import { bench, describe } from "vitest";
import { add, multiply, divide, parseScientific as parse, toPlainString } from "../src/index";

// Invoice inputs: unit price, quantity, tax rate. Keep a sink to retain results.
const inputs = [["19.99", "3", "1.10"], ["1250.00", "12", "1.08"], ["0.0750", "10000", "1.20"]];
const values = inputs.map(row => row.map(parse));
let sink: unknown;

describe("invoice workload", () => {
  bench("parse only", () => { for (const row of inputs) for (const value of row) sink = parse(value); });
  bench("arithmetic only (preparsed)", () => {
    for (const [price, quantity, tax] of values) sink = divide(multiply(multiply(price!, quantity!), tax!), parseOne, 2, "HALF_EVEN");
  });
  bench("format only", () => { for (const row of values) for (const value of row) sink = toPlainString(value); });
  bench("parse, invoice arithmetic, format", () => {
    let total = parse("0.00");
    for (const [price, quantity, tax] of inputs) {
      total = add(total, divide(multiply(multiply(parse(price!), parse(quantity!)), parse(tax!)), parseOne, 2, "HALF_EVEN"));
    }
    sink = toPlainString(total);
  });
});
const parseOne = parse("1");
void sink;
