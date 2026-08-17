import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLoginIdentifier } from "../lib/auth/login-identifier.ts";

test("normalizes an email without changing its authentication meaning", () => {
  assert.deepEqual(normalizeLoginIdentifier("  Admin@Rasa.example  "), {
    kind: "email",
    value: "admin@rasa.example",
  });
});

test("normalizes a staff ID case-insensitively", () => {
  assert.deepEqual(normalizeLoginIdentifier(" rasa-admin_001 "), {
    kind: "login-id",
    value: "RASA-ADMIN_001",
  });
});

test("rejects malformed, control-character and oversized identifiers", () => {
  assert.equal(normalizeLoginIdentifier("ab"), null);
  assert.equal(normalizeLoginIdentifier("admin id"), null);
  assert.equal(normalizeLoginIdentifier("admin\n001"), null);
  assert.equal(normalizeLoginIdentifier(`${"A".repeat(255)}@example.test`), null);
  assert.equal(normalizeLoginIdentifier({ identifier: "ADMIN-001" }), null);
});
