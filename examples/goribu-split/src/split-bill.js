export function splitBill(amount, people) {
  const value = amount.trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(value)) {
    return { field: "amount", error: "Enter a bill from €0.01 to €999,999.99, using a dot and at most two decimal places." };
  }
  const [euros, fraction = ""] = value.split(".");
  const total = Number(euros) * 100 + Number(fraction.padEnd(2, "0"));
  if (total === 0) return { field: "amount", error: "Enter a bill greater than €0.00." };
  if (!/^\d{1,3}$/.test(people.trim()) || Number(people) < 1 || Number(people) > 100) {
    return { field: "people", error: "Enter a whole number of people from 1 to 100." };
  }
  const count = Number(people);
  const base = Math.floor(total / count);
  const extra = total % count;
  // Distribute the remaining whole cents instead of rounding every share up.
  const groups = extra === 0
    ? [{ count, cents: base }]
    : [{ count: extra, cents: base + 1 }, { count: count - extra, cents: base }];
  return { total, groups };
}

export function euros(cents) {
  return `€${(cents / 100).toFixed(2)}`;
}
