import { createHash } from "node:crypto";

export function sha256(parts: readonly (string | number | boolean | null | undefined)[]): string {
  const hash = createHash("sha256");

  for (const part of parts) {
    hash.update(JSON.stringify(part ?? null));
    hash.update("\u001f");
  }

  return hash.digest("hex");
}
