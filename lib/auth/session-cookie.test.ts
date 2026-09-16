import { describe, expect, it } from "vitest";

import { sessionCookieFor } from "./session-cookie";

/**
 * The failure this guards against is silent: write the wrong name and the
 * session row exists, the cookie exists, and the user is bounced straight
 * back to the sign-in page with no error anywhere. That is exactly how it
 * presented the first time dev sign-in ran on a deployed HTTPS
 * environment.
 */
describe("sessionCookieFor", () => {
  it("uses the __Secure- prefix over HTTPS, matching what Auth.js reads", () => {
    expect(sessionCookieFor("https")).toEqual({
      name: "__Secure-authjs.session-token",
      secure: true,
    });
  });

  it("uses the bare name over plain HTTP, since a browser would reject a __Secure- cookie there", () => {
    expect(sessionCookieFor("http")).toEqual({
      name: "authjs.session-token",
      secure: false,
    });
  });

  it("falls back to the non-secure name when the header is absent", () => {
    // A direct request with no proxy in front of it — local development.
    expect(sessionCookieFor(null)).toEqual({
      name: "authjs.session-token",
      secure: false,
    });
  });

  it.each(["HTTPS", "Https", "https,http", " https", ""])(
    "treats %o as not-HTTPS rather than guessing",
    (protocol) => {
      // Marking a cookie Secure on a connection that is not actually
      // HTTPS gets it dropped by the browser, which fails the same silent
      // way. When the header is not exactly "https", the safe answer is
      // the name that always works.
      expect(sessionCookieFor(protocol).secure).toBe(false);
      expect(sessionCookieFor(protocol).name).toBe("authjs.session-token");
    }
  );
});
