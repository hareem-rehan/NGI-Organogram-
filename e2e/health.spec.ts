import { test, expect } from "@playwright/test";

test.describe("Health endpoint", () => {
  test("GET returns a safe, well-formed payload", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(typeof body.application).toBe("string");
    expect(typeof body.environment).toBe("string");
    expect(typeof body.timestamp).toBe("string");

    const serialized = JSON.stringify(body).toLowerCase();
    for (const forbidden of ["password", "secret", "database_url", "stack", "/users/"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("an unsupported HTTP method is rejected", async ({ request }) => {
    const response = await request.post("/api/health");
    expect(response.status()).toBe(405);
  });

  test("readiness reports the database is reachable, and leaks nothing about it", async ({
    request,
  }) => {
    const response = await request.get("/api/health/ready");
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("reachable");

    // A probe that anyone can call before signing in must give away
    // nothing beyond reachable/not — no host, no driver, no error text.
    const serialized = JSON.stringify(body).toLowerCase();
    for (const forbidden of [
      "password",
      "secret",
      "database_url",
      "postgres",
      "localhost",
      "supabase",
      "prisma",
      "stack",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("readiness is distinct from liveness — /api/health never touches the database", async ({
    request,
  }) => {
    // Both are green here; what this pins is that they are separate
    // endpoints with separate contracts, so a future change cannot
    // quietly make the deploy smoke check depend on the database.
    const live = await request.get("/api/health");
    const ready = await request.get("/api/health/ready");
    expect(live.status()).toBe(200);
    expect(ready.status()).toBe(200);
    expect((await live.json()).database).toBeUndefined();
  });
});
