import assert from "node:assert/strict";
import { test } from "node:test";
import { euros, splitBill } from "../src/split-bill.js";

test("splits evenly or distributes the remainder without losing cents", () => {
  assert.deepEqual(splitBill("42.00", "3").groups, [{ count: 3, cents: 1400 }]);
  assert.deepEqual(splitBill("10", "3").groups, [{ count: 1, cents: 334 }, { count: 2, cents: 333 }]);
  assert.deepEqual(splitBill("0.01", "3").groups, [{ count: 1, cents: 1 }, { count: 2, cents: 0 }]);
  for (const amount of ["0.01", "0.29", "10.1", "42.00", "999999.99"]) {
    for (const people of ["1", "3", "7", "100"]) {
      const result = splitBill(amount, people);
      assert.equal(result.groups.reduce((sum, group) => sum + group.count * group.cents, 0), result.total);
      assert.equal(result.groups.reduce((sum, group) => sum + group.count, 0), Number(people));
    }
  }
  assert.equal(euros(334), "€3.34");
});

test("shows repair instructions for empty, fractional or out-of-range inputs", () => {
  for (const amount of ["", " ", "0", "-2", "1.001", "1e2", "1,50", "1000000"]) {
    assert.equal(splitBill(amount, "3").field, "amount", amount);
    assert.ok(splitBill(amount, "3").error);
  }
  for (const people of ["", "0", "-1", "1.5", "101", "1e2"]) {
    assert.equal(splitBill("42", people).field, "people", people);
    assert.ok(splitBill("42", people).error);
  }
});
