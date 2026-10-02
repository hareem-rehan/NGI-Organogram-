"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  compactTextStyle,
  DEFAULT_TITLE_SIZE,
  FONT_FAMILIES,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  readableTextColor,
  type TextStyle,
} from "@/lib/domain/organogram-text-style";
import { CARD_TEXT_COLOR, cardTextColor } from "@/lib/domain/organogram-family-colors";
import { cn } from "@/lib/utils";

interface TextStylePanelProps {
  open: boolean;
  /** "All cards", or the one card's title. */
  targetLabel: string;
  /** True for the chart-wide style; false for one card's override. */
  isChart: boolean;
  /** The target's own saved style (what is being edited). */
  saved: TextStyle;
  /** What the target inherits when a field is left at its default (the chart style, for a card). */
  inherited: TextStyle;
  /**
   * The card's own fill colour (one card only). Lets the panel show the text
   * colour the card ACTUALLY uses: a chosen colour that would be hard to read
   * on this fill is swapped for a readable one, exactly as on the chart.
   */
  cardFill?: string | null;
  /** Called on every change, so the chart previews the style live. */
  onPreview: (style: TextStyle) => void;
  /** Saves; resolves to an error message, or null on success. */
  onSave: (style: TextStyle) => Promise<string | null>;
  /** Removes the target's own style (back to inheriting); resolves like onSave. */
  onReset: () => Promise<string | null>;
  onClose: () => void;
}

const SIZES = Array.from(
  { length: MAX_FONT_SIZE - MIN_FONT_SIZE + 1 },
  (_, i) => MIN_FONT_SIZE + i
);

/**
 * Text style editor for organogram cards (docs/DECISIONS.md D41): font
 * family, size, colour, bold, italic, underline, strikethrough — for every
 * card, or one card on top of that. Changes preview live on the chart;
 * nothing is saved until "Save". The parent remounts it per target.
 */
export function TextStylePanel({
  open,
  targetLabel,
  isChart,
  saved,
  inherited,
  cardFill,
  onPreview,
  onSave,
  onReset,
  onClose,
}: TextStylePanelProps) {
  const [style, setStyle] = useState<TextStyle>(saved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: TextStyle) => {
    const next = compactTextStyle({ ...style, ...patch });
    setStyle(next);
    onPreview(next);
  };

  // A toggle shows the EFFECTIVE value (own setting, else inherited); turning
  // it off when it is inherited as on stores an explicit "off".
  const effective = { ...compactTextStyle(inherited), ...style };

  // The text colour as the card really shows it (D50): on one card, a chosen
  // colour that isn't readable on its fill is swapped, just like the chart.
  const chosenColour = style.color ?? inherited.color ?? null;
  const fill = cardFill ?? null;
  const colourShown = fill
    ? readableTextColor(chosenColour, fill, cardTextColor(fill))
    : (chosenColour ?? CARD_TEXT_COLOR);
  const swapped = !!fill && !!chosenColour && colourShown !== chosenColour;
  const colourLabel = swapped
    ? `${colourShown} on this card`
    : style.color
      ? style.color
      : chosenColour
        ? `${chosenColour} (same as all cards)`
        : fill
          ? `${colourShown} (automatic)`
          : "Automatic";
  const toggle = (field: "italic" | "underline" | "strikethrough") => {
    const on = effective[field] === true;
    update({ [field]: on ? (inherited[field] ? false : null) : true });
  };

  const run = async (action: () => Promise<string | null>) => {
    setPending(true);
    setError(null);
    const message = await action();
    setPending(false);
    if (message) setError(message);
    else onClose();
  };

  const inheritLabel = isChart ? "Default" : "Same as all cards";
  const hasOwn = Object.keys(compactTextStyle(saved)).length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        title={`Text style — ${targetLabel}`}
        description={
          isChart
            ? "Applies to every card on the chart. A card's own text style wins over this."
            : "Applies to this card only, on top of the style for all cards."
        }
      >
        <div className="flex flex-col gap-4">
          {error ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          ) : null}

          <Field label="Font">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={style.fontFamily ?? ""}
                onChange={(event) => update({ fontFamily: event.target.value || null })}
              >
                <option value="">{inheritLabel}</option>
                {FONT_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>
                    {f.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Size" hint="The card title's size; the other lines scale with it.">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={style.fontSize ? String(style.fontSize) : ""}
                onChange={(event) =>
                  update({ fontSize: event.target.value ? Number(event.target.value) : null })
                }
              >
                <option value="">
                  {inheritLabel}
                  {isChart ? ` (${DEFAULT_TITLE_SIZE}px)` : ""}
                </option>
                {SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Text colour"
            hint={
              swapped
                ? `${chosenColour} is hard to read on this card's colour, so ${colourShown} is used instead. Pick a darker or lighter colour to change it.`
                : isChart
                  ? "On any card where this colour would be hard to read, a readable colour is used instead."
                  : "Default keeps text readable on the card colour automatically."
            }
          >
            {(fieldProps) => (
              <div className="flex items-center gap-2">
                <input
                  {...fieldProps}
                  type="color"
                  value={colourShown}
                  onChange={(event) => update({ color: event.target.value })}
                  className="border-input h-9 w-12 cursor-pointer rounded border bg-transparent p-1"
                />
                <span className="text-muted-foreground font-mono text-sm">{colourLabel}</span>
                {style.color ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => update({ color: null })}
                  >
                    {inheritLabel}
                  </Button>
                ) : null}
              </div>
            )}
          </Field>

          <Field label="Weight">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={style.bold === true ? "bold" : style.bold === false ? "regular" : ""}
                onChange={(event) =>
                  update({
                    bold:
                      event.target.value === "bold"
                        ? true
                        : event.target.value === "regular"
                          ? false
                          : null,
                  })
                }
              >
                <option value="">{inheritLabel} (bold titles)</option>
                <option value="bold">Bold — all text</option>
                <option value="regular">Regular — no bold</option>
              </Select>
            )}
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Style</span>
            <div className="flex gap-2" role="group" aria-label="Text style options">
              {(
                [
                  ["italic", "Italic", "italic", "I"],
                  ["underline", "Underline", "underline", "U"],
                  ["strikethrough", "Strikethrough", "line-through", "S"],
                ] as const
              ).map(([field, label, css, glyph]) => (
                <button
                  key={field}
                  type="button"
                  aria-pressed={effective[field] === true}
                  aria-label={label}
                  title={label}
                  onClick={() => toggle(field)}
                  className={cn(
                    "border-input focus-visible:ring-ring flex size-9 items-center justify-center rounded-md border text-sm font-semibold outline-none focus-visible:ring-2",
                    effective[field] === true
                      ? "bg-primary text-primary-foreground"
                      : "bg-background"
                  )}
                  style={css === "italic" ? { fontStyle: "italic" } : { textDecorationLine: css }}
                >
                  {glyph}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" disabled={pending} onClick={() => run(() => onSave(style))}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            {hasOwn ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => run(onReset)}
              >
                {isChart ? "Reset to default" : "Use the style for all cards"}
              </Button>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
