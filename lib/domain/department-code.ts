/**
 * Department codes are generated, not typed (D51): the Code field was removed
 * from the Department form. The code stays an internal key (CSV imports, the
 * "(DOA)" labels, filters), so a new department gets one built from its
 * name: the initials of its words — "Delivery Org / Administration" → DOA,
 * "Human Resources" → HR — or, for a one-word name, its first three letters
 * ("Engineering" → ENG).
 */
export function departmentCodeFromName(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "DEPT";
  const code =
    words.length === 1
      ? words[0]!.slice(0, 3)
      : words
          .map((word) => word[0])
          .join("")
          .slice(0, 6);
  const upper = code.toUpperCase();
  // Codes are at least two characters (the form's old rule).
  return upper.length >= 2
    ? upper
    : `${upper}${words[0]!.slice(1, 3).toUpperCase()}`.padEnd(2, "X");
}

/**
 * The first of `base`, `base2`, `base3`, … that is not already taken
 * (compared case-insensitively). Codes are at most 30 characters.
 */
export function firstFreeCode(base: string, taken: ReadonlySet<string>): string {
  const isTaken = (code: string) => taken.has(code.toUpperCase());
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}
