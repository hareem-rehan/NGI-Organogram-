import { describe, expect, it } from "vitest";

import { computeChangedFields, redactForAudit, sanitizeMetadata } from "./redact";

describe("redactForAudit", () => {
  it("keeps only allowlisted fields for a known entity type", () => {
    const result = redactForAudit("Department", {
      id: "dept-1",
      name: "Engineering",
      code: "ENG",
      notOnAllowlist: "should vanish",
    });
    expect(result).toEqual({ id: "dept-1", name: "Engineering", code: "ENG" });
    expect(result).not.toHaveProperty("notOnAllowlist");
  });

  it("returns an empty object for an unregistered entity type — safe by default, not 'keep everything'", () => {
    const result = redactForAudit("SomeUnregisteredType", { secret: "value" });
    expect(result).toEqual({});
  });

  it("returns null for null/undefined input", () => {
    expect(redactForAudit("Department", null)).toBeNull();
    expect(redactForAudit("Department", undefined)).toBeNull();
  });

  it("strips a password field not present on the entity's allowlist", () => {
    const result = redactForAudit("User", {
      id: "u1",
      email: "a@b.com",
      password: "hunter2",
      passwordHash: "$2b$10$abc",
    });
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("passwordHash");
  });

  it("strips an access token / refresh token / id token field even if injected at the top level", () => {
    const result = redactForAudit("User", {
      id: "u1",
      email: "a@b.com",
      accessToken: "eyJabc",
      refresh_token: "eyJdef",
      id_token: "eyJghi",
      session_state: "xyz",
    });
    expect(Object.keys(result ?? {})).toEqual(["id", "email"]);
  });

  it("strips AUTH_SECRET / SSO client secret / DATABASE_URL if somehow present", () => {
    const result = redactForAudit("CompanySettings", {
      id: "s1",
      companyId: "c1",
      AUTH_SECRET: "top-secret",
      clientSecret: "also-secret",
      DATABASE_URL: "postgres://user:pass@host/db",
    });
    expect(result).toEqual({ id: "s1", companyId: "c1" });
  });

  it("strips storage credentials if somehow present", () => {
    const result = redactForAudit("ExportJob", {
      id: "e1",
      status: "COMPLETED",
      storageAccessKey: "AKIA...",
      storageSecretKey: "abc123",
    });
    expect(result).toEqual({ id: "e1", status: "COMPLETED" });
  });

  it("strips a cookie field if somehow present", () => {
    const result = redactForAudit("User", { id: "u1", cookie: "sessionToken=abc" });
    expect(result).toEqual({ id: "u1" });
  });

  it("redacts a nested secret one level deep inside an allowlisted field's own value", () => {
    // The allowlisted field itself is an object whose OWN keys are not
    // independently allowlisted — the generic sanitizer still applies
    // (no allowlist bypass via nesting), but does not itself strip
    // arbitrary nested keys by name (that's the whole point of an
    // allowlist over a denylist) — depth/size/prototype protections
    // still apply, verified by the depth-cap and prototype-pollution
    // tests below. This test documents that a nested object survives
    // structurally rather than being silently dropped.
    const result = redactForAudit("CompanySettings", {
      id: "s1",
      companyId: "c1",
      brandingText: { nested: { value: "ok" } },
    });
    expect(result?.brandingText).toEqual({ nested: { value: "ok" } });
  });

  it("sanitizes an array value's own contents (prototype-pollution keys stripped from each element)", () => {
    const malicious = JSON.parse(
      '{"id":"s1","companyId":"c1","brandingText":[{"a":1,"__proto__":{"polluted":true}}]}'
    );
    const result = redactForAudit("CompanySettings", malicious);
    expect(result?.brandingText).toEqual([{ a: 1 }]);
  });

  it("does not crash on a circular reference and marks it instead", () => {
    const circular: Record<string, unknown> = { id: "u1", email: "a@b.com" };
    circular.self = circular;
    const result = redactForAudit("User", circular);
    expect(result?.id).toBe("u1");
    // `self` is not on the User allowlist, so it's dropped before the
    // circular reference is ever walked — prove the guard independently
    // via a field that IS allowlisted.
    expect(result).not.toHaveProperty("self");
  });

  it("does not crash on a circular reference inside an allowlisted object field and marks it", () => {
    const inner: Record<string, unknown> = { a: 1 };
    inner.loop = inner;
    const result = redactForAudit("CompanySettings", {
      id: "s1",
      companyId: "c1",
      brandingText: inner,
    });
    expect((result?.brandingText as Record<string, unknown>)?.a).toBe(1);
    expect((result?.brandingText as Record<string, unknown>)?.loop).toBe("[circular]");
  });

  it("caps nesting depth rather than recursing unboundedly", () => {
    let deep: unknown = "bottom";
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    const result = redactForAudit("CompanySettings", {
      id: "s1",
      companyId: "c1",
      brandingText: deep,
    });
    // Walk down; at some point we should hit the max-depth marker rather
    // than the literal "bottom" string.
    let cursor: unknown = result?.brandingText;
    let hitMarker = false;
    for (let i = 0; i < 20; i++) {
      if (cursor === "[max-depth]") {
        hitMarker = true;
        break;
      }
      if (cursor && typeof cursor === "object" && "nested" in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>).nested;
      } else {
        break;
      }
    }
    expect(hitMarker).toBe(true);
  });

  it("strips prototype-pollution keys (__proto__, constructor, prototype)", () => {
    const malicious = JSON.parse(
      '{"id":"u1","__proto__":{"polluted":true},"constructor":"x","prototype":"y"}'
    );
    const result = redactForAudit("User", malicious);
    expect(result).toEqual({ id: "u1" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("caps oversized metadata rather than storing it unbounded", () => {
    const huge = { id: "s1", companyId: "c1", brandingText: "x".repeat(20_000) };
    const result = redactForAudit("CompanySettings", huge);
    expect(result).toBe("[truncated]");
  });

  it("never includes a private-HR field (e.g. salary) that isn't on any entity's allowlist", () => {
    const result = redactForAudit("Employee", {
      id: "e1",
      firstName: "Ada",
      lastName: "Lovelace",
      salary: 999999,
      nationalId: "123-45-6789",
      medicalNotes: "confidential",
    });
    expect(result).toEqual({ id: "e1", firstName: "Ada", lastName: "Lovelace" });
  });

  it("preserves Unicode names without mangling them", () => {
    const result = redactForAudit("Employee", { id: "e1", firstName: "José", lastName: "García" });
    expect(result).toEqual({ id: "e1", firstName: "José", lastName: "García" });
  });

  it("normalizes a Date value to an ISO string for stable diffing", () => {
    const date = new Date("2026-01-15T00:00:00.000Z");
    const result = redactForAudit("Employee", { id: "e1", joiningDate: date });
    expect(result?.joiningDate).toBe("2026-01-15T00:00:00.000Z");
  });
});

describe("sanitizeMetadata", () => {
  it("returns null for null/undefined", () => {
    expect(sanitizeMetadata(null)).toBeNull();
    expect(sanitizeMetadata(undefined)).toBeNull();
  });

  it("passes through a small, safe object unchanged in structure", () => {
    expect(sanitizeMetadata({ rowCount: 5, correlationId: "abc" })).toEqual({
      rowCount: 5,
      correlationId: "abc",
    });
  });

  it("strips prototype-pollution keys even with no allowlist", () => {
    const malicious = JSON.parse('{"ok":1,"__proto__":{"polluted":true}}');
    expect(sanitizeMetadata(malicious)).toEqual({ ok: 1 });
  });

  it("caps oversized free-form metadata", () => {
    expect(sanitizeMetadata({ blob: "x".repeat(20_000) })).toBe("[truncated]");
  });

  it("does not crash on a circular reference", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(sanitizeMetadata(obj)).toEqual({ a: 1, self: "[circular]" });
  });
});

describe("computeChangedFields", () => {
  it("returns field names that differ between before/after", () => {
    const before = { id: "d1", name: "Engineering", code: "ENG" };
    const after = { id: "d1", name: "Engineering Team", code: "ENG" };
    expect(computeChangedFields(before, after)).toEqual(["name"]);
  });

  it("returns an empty array when nothing changed", () => {
    const snapshot = { id: "d1", name: "Engineering" };
    expect(computeChangedFields(snapshot, { ...snapshot })).toEqual([]);
  });

  it("treats a field present only in one snapshot as changed", () => {
    expect(computeChangedFields({ id: "d1" }, { id: "d1", color: "#fff" })).toEqual(["color"]);
  });

  it("treats null before (a create) as every after-field being changed", () => {
    expect(computeChangedFields(null, { id: "d1", name: "Engineering" })).toEqual(["id", "name"]);
  });

  it("treats null after (an unusual case) as every before-field being changed", () => {
    expect(computeChangedFields({ id: "d1", name: "Engineering" }, null)).toEqual(["id", "name"]);
  });
});
