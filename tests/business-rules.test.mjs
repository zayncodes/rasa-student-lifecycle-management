import assert from "node:assert/strict";
import test from "node:test";

function feeSummary(total, payments) {
  const paid = payments.filter((payment) => payment.status === "Posted").reduce((sum, payment) => sum + payment.amount, 0);
  const pending = total - paid;
  return { paid, pending, status: pending <= 0 ? (pending < 0 ? "Overpaid" : "Paid") : paid === 0 ? "Unpaid" : "Partially Paid" };
}

test("voided payments do not reduce the pending fee", () => {
  assert.deepEqual(feeSummary(48000, [{ amount: 16000, status: "Posted" }, { amount: 5000, status: "Voided" }]), { paid: 16000, pending: 32000, status: "Partially Paid" });
});

test("multiple posted payments produce a paid account", () => {
  assert.deepEqual(feeSummary(48000, [{ amount: 16000, status: "Posted" }, { amount: 32000, status: "Posted" }]), { paid: 48000, pending: 0, status: "Paid" });
});

test("project overdue is derived instead of stored", () => {
  const isOverdue = (deadline, status, today) => new Date(deadline) < new Date(today) && !["Completed", "Cancelled"].includes(status);
  assert.equal(isOverdue("2026-08-10", "Under Review", "2026-08-13"), true);
  assert.equal(isOverdue("2026-08-10", "Completed", "2026-08-13"), false);
});
