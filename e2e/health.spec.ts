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
});
