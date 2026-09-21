/**
 * Pure SVG text-safety helpers. Every user-controlled string (position
 * title, code, department name, occupant name, job grade name, company
 * name) MUST pass through `escapeXmlText` before being placed inside an
 * SVG `<text>`/`<tspan>` element — this is the single control preventing
 * SVG/XML injection (docs/NEGATIVE_SCENARIOS.md's export section,
 * "HTML/SVG injection in position title").
 */

/**
 * Escapes the five XML-significant characters for safe use as element
 * TEXT CONTENT (not inside an attribute value — `resolveDepartmentColor`'s
 * output and similar are only ever used as validated hex/known strings in
 * attributes, never raw user text, so a separate attribute-escaper is not
 * needed here). Ampersand is replaced first, matching the correct order to
 * avoid double-escaping.
 */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Greedy word-wrap into at most `maxLines` lines of at most
 * `maxCharsPerLine` characters each, truncating the final line with an
 * ellipsis if content remains. A single "word" longer than the line width
 * is hard-broken rather than overflowing the card (Step 6's "long names
 * and titles must wrap safely").
 */
export function wrapText(value: string, maxCharsPerLine: number, maxLines: number): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0 || maxLines <= 0 || maxCharsPerLine <= 0) return [];

  // Pass 1: wrap the ENTIRE string into as many lines as it takes, with
  // no line-count limit yet — a word longer than the line width is
  // hard-broken into full-width chunks. This keeps the wrapping logic
  // itself simple and unconditionally correct; truncation is a wholly
  // separate second pass below.
  const words = trimmed.split(/\s+/);
  const allLines: string[] = [];
  let current = "";

  const flushCurrent = () => {
    if (current) {
      allLines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      flushCurrent();
      let remaining = word;
      while (remaining.length > maxCharsPerLine) {
        allLines.push(remaining.slice(0, maxCharsPerLine));
        remaining = remaining.slice(maxCharsPerLine);
      }
      current = remaining;
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      flushCurrent();
      current = word;
    }
  }
  flushCurrent();

  if (allLines.length <= maxLines) return allLines;

  // Pass 2: too many lines — keep the first (maxLines - 1) verbatim and
  // collapse everything else into one final, ellipsis-truncated line
  // that is guaranteed to fit within maxCharsPerLine.
  const kept = allLines.slice(0, maxLines - 1);
  const rest = allLines.slice(maxLines - 1).join(" ");
  const lastLineBudget = maxCharsPerLine - 1; // reserve 1 character for the ellipsis
  const truncatedRest =
    rest.length > lastLineBudget ? `${rest.slice(0, lastLineBudget)}…` : `${rest}…`;
  kept.push(truncatedRest);
  return kept;
}
