import { describe, expect, it } from "vitest";

import { resolveOrProvisionUserForSignIn } from "@/lib/services/user.service";
import { testPrisma } from "./setup";
import { makeCompany } from "./fixtures";

describe("resolveOrProvisionUserForSignIn", () => {
  it("allows a pre-provisioned ADMIN and links their SSO account on first sign-in", async () => {
    const company = await makeCompany();
    const admin = await testPrisma.user.create({
      data: { email: "admin@example.test", companyId: company.id, role: "ADMIN", status: "ACTIVE" },
    });

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-admin-1",
      email: "admin@example.test",
      displayName: "Admin User",
      imageUrl: null,
      autoProvisionViewers: false,
    });

    expect(resolution.outcome).toBe("allow");
    if (resolution.outcome === "allow") {
      expect(resolution.user.id).toBe(admin.id);
      expect(resolution.user.role).toBe("ADMIN");
      expect(resolution.isNewUser).toBe(false);
    }
  });

  it("allows a pre-provisioned HR_EDITOR", async () => {
    const company = await makeCompany();
    await testPrisma.user.create({
      data: {
        email: "editor@example.test",
        companyId: company.id,
        role: "HR_EDITOR",
        status: "ACTIVE",
      },
    });

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-editor-1",
      email: "editor@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: false,
    });

    expect(resolution.outcome).toBe("allow");
    if (resolution.outcome === "allow") expect(resolution.user.role).toBe("HR_EDITOR");
  });

  it("allows a pre-provisioned VIEWER", async () => {
    const company = await makeCompany();
    await testPrisma.user.create({
      data: {
        email: "viewer@example.test",
        companyId: company.id,
        role: "VIEWER",
        status: "ACTIVE",
      },
    });

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-viewer-1",
      email: "viewer@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: false,
    });

    expect(resolution.outcome).toBe("allow");
    if (resolution.outcome === "allow") expect(resolution.user.role).toBe("VIEWER");
  });

  it("denies an unknown user when auto-provisioning is disabled", async () => {
    await makeCompany();

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-unknown-1",
      email: "unknown@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: false,
    });

    expect(resolution).toEqual({ outcome: "deny", reason: "unprovisioned" });
  });

  it("auto-provisions an unknown user as VIEWER when enabled, never a higher role", async () => {
    await makeCompany();

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-new-1",
      email: "new-employee@example.test",
      displayName: "New Employee",
      imageUrl: "https://example.test/avatar.png",
      autoProvisionViewers: true,
    });

    expect(resolution.outcome).toBe("allow");
    if (resolution.outcome === "allow") {
      expect(resolution.user.role).toBe("VIEWER");
      expect(resolution.isNewUser).toBe(true);
      expect(resolution.user.name).toBe("New Employee");
    }
  });

  it("never auto-provisions ADMIN or HR_EDITOR regardless of the flag", async () => {
    await makeCompany();

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-new-2",
      email: "another-new@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: true,
    });

    expect(resolution.outcome).toBe("allow");
    if (resolution.outcome === "allow") {
      expect(resolution.user.role).not.toBe("ADMIN");
      expect(resolution.user.role).not.toBe("HR_EDITOR");
      expect(resolution.user.role).toBe("VIEWER");
    }
  });

  it("refuses auto-provisioning when zero companies exist", async () => {
    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-orphan-1",
      email: "orphan@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: true,
    });

    expect(resolution).toEqual({ outcome: "deny", reason: "unprovisioned" });
  });

  it("refuses auto-provisioning when more than one company exists (ambiguous)", async () => {
    await makeCompany();
    await makeCompany();

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-ambiguous-1",
      email: "ambiguous@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: true,
    });

    expect(resolution).toEqual({ outcome: "deny", reason: "unprovisioned" });
  });

  it("denies a disabled user even if their Account is already linked", async () => {
    const company = await makeCompany();
    const user = await testPrisma.user.create({
      data: {
        email: "disabled@example.test",
        companyId: company.id,
        role: "VIEWER",
        status: "DISABLED",
      },
    });
    await testPrisma.account.create({
      data: {
        userId: user.id,
        type: "oidc",
        provider: "company-sso",
        providerAccountId: "sub-disabled-1",
      },
    });

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-disabled-1",
      email: "disabled@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: false,
    });

    expect(resolution).toEqual({ outcome: "deny", reason: "disabled" });
  });

  it("denies a disabled pre-provisioned (not-yet-linked) user", async () => {
    const company = await makeCompany();
    await testPrisma.user.create({
      data: {
        email: "disabled-preprovisioned@example.test",
        companyId: company.id,
        role: "HR_EDITOR",
        status: "DISABLED",
      },
    });

    const resolution = await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-disabled-2",
      email: "disabled-preprovisioned@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: false,
    });

    expect(resolution).toEqual({ outcome: "deny", reason: "disabled" });
  });

  it("updates lastLoginAt on a successful resolution", async () => {
    const company = await makeCompany();
    const user = await testPrisma.user.create({
      data: { email: "login-check@example.test", companyId: company.id, role: "VIEWER" },
    });
    expect(user.lastLoginAt).toBeNull();

    await resolveOrProvisionUserForSignIn({
      provider: "company-sso",
      providerAccountId: "sub-login-check",
      email: "login-check@example.test",
      displayName: null,
      imageUrl: null,
      autoProvisionViewers: false,
    });

    const updated = await testPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.lastLoginAt).not.toBeNull();
  });

  it("rejects a duplicate external identity (same provider+subject already linked to a different email's account)", async () => {
    const company = await makeCompany();
    const userA = await testPrisma.user.create({
      data: { email: "user-a@example.test", companyId: company.id, role: "VIEWER" },
    });
    await testPrisma.account.create({
      data: {
        userId: userA.id,
        type: "oidc",
        provider: "company-sso",
        providerAccountId: "shared-sub",
      },
    });

    await expect(
      testPrisma.account.create({
        data: {
          userId: (
            await testPrisma.user.create({
              data: { email: "user-b@example.test", companyId: company.id, role: "VIEWER" },
            })
          ).id,
          type: "oidc",
          provider: "company-sso",
          providerAccountId: "shared-sub",
        },
      })
    ).rejects.toThrow();
  });
});
