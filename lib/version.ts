import "server-only";
import packageJson from "../package.json";

/** Application version from package.json. Never throws — falls back to null so the health endpoint stays safe even if this ever fails to resolve. */
export function getAppVersion(): string | null {
  return typeof packageJson.version === "string" ? packageJson.version : null;
}
