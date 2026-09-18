import { afterEach, describe, expect, it, vi } from "vitest";

import { testPrisma } from "./setup";
import { createDevSession } from "@/lib/auth/dev-sign-in";

describe("createDevSession", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a real, valid database session for the requested role, backed by a stable local-dev company", async () => {
    const result = await createDevSession("ADMIN");
    expect(result.sessionToken).toHaveLength(64); // 32 bytes, hex-encoded

    const session = await testPrisma.session.findUniqueOrThrow({
      where: { sessionToken: result.sessionToken },
      include: { user: true },
    });
    expect(session.user.role).toBe("ADMIN");
    expect(session.user.status).toBe("ACTIVE");
    expect(session.expires.getTime()).toBeGreaterThan(Date.now());

    const company = await testPrisma.company.findUniqueOrThrow({
      where: { id: session.user.companyId },
    });
    expect(company.code).toBe("DEV-LOCAL");
  });

  it("is idempotent — a second call for the same role reuses the same company and user, not a duplicate", async () => {
    const first = await createDevSession("HR_EDITOR");
    const second = await createDevSession("HR_EDITOR");

    const [firstSession, secondSession] = await Promise.all([
      testPrisma.session.findUniqueOrThrow({ where: { sessionToken: first.sessionToken } }),
      testPrisma.session.findUniqueOrThrow({ where: { sessionToken: second.sessionToken } }),
    ]);

    // Two distinct sessions (a fresh token every call, matching a real
    // sign-in), but for the exact same underlying user/company.
    expect(second.sessionToken).not.toBe(first.sessionToken);
    expect(secondSession.userId).toBe(firstSession.userId);

    // Scoped correctly: only ever one HR_EDITOR created for the DEV-LOCAL company specifically.
    const company = await testPrisma.company.findUniqueOrThrow({ where: { code: "DEV-LOCAL" } });
    const hrEditorsInDevCompany = await testPrisma.user.count({
      where: { companyId: company.id, role: "HR_EDITOR" },
    });
    expect(hrEditorsInDevCompany).toBe(1);
  });

  it("creates a separate user per role within the same shared DEV-LOCAL company", async () => {
    const admin = await createDevSession("ADMIN");
    const viewer = await createDevSession("VIEWER");

    const [adminSession, viewerSession] = await Promise.all([
      testPrisma.session.findUniqueOrThrow({
        where: { sessionToken: admin.sessionToken },
        include: { user: true },
      }),
      testPrisma.session.findUniqueOrThrow({
        where: { sessionToken: viewer.sessionToken },
        include: { user: true },
      }),
    ]);

    expect(adminSession.user.companyId).toBe(viewerSession.user.companyId);
    expect(adminSession.user.id).not.toBe(viewerSession.user.id);
    expect(adminSession.user.role).toBe("ADMIN");
    expect(viewerSession.user.role).toBe("VIEWER");
  });

  it("refuses to run when NODE_ENV is production, even against a real database connection", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(createDevSession("ADMIN")).rejects.toThrow(/disabled outside local development/i);
  });
});
