"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  id?: string;
  value: string | null;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  loading?: boolean;
  emptyMessage?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}

/**
 * Searchable single-select combobox (Reports-To / eligible-position
 * pickers — components that need server-side filtered search over a
 * potentially large list, unlike the native <select> used for bounded
 * option sets). Built on Radix Popover for focus/dismiss handling, with
 * a manual listbox for full control over option rendering
 * (title/code/department/status).
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  query,
  onQueryChange,
  placeholder,
  loading,
  emptyMessage = "No matches.",
  disabled,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const listboxId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const selectedOption = options.find((option) => option.value === value) ?? null;

  function selectOption(option: ComboboxOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) selectOption(option);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div className="relative">
          <Input
            id={id}
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 && options[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
            }
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            aria-label={ariaLabel}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder}
            value={open ? query : (selectedOption?.label ?? query)}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            className="pr-8"
          />
          {loading ? (
            <Loader2
              aria-hidden="true"
              className="text-muted-foreground absolute top-1/2 right-2 size-4 -translate-y-1/2 animate-spin"
            />
          ) : (
            <ChevronDown
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2"
            />
          )}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          onOpenAutoFocus={(event) => event.preventDefault()}
          align="start"
          sideOffset={4}
          className="border-border bg-background z-50 max-h-64 w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {options.length === 0 ? (
            // `role="listbox"` requires every child to be `role="option"`
            // (axe's `aria-required-children`/`listitem` rules, found via
            // e2e/accessibility.spec.ts's organogram search scan — a
            // plain <li> status message doesn't qualify) — render the
            // empty message as an ordinary paragraph, with no listbox at
            // all, rather than a listbox containing an invalid child.
            <p id={listboxId} className="text-muted-foreground px-2 py-3 text-center text-sm">
              {emptyMessage}
            </p>
          ) : (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              className="flex flex-col gap-0.5"
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(option)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 rounded-sm px-2 py-1.5 text-sm",
                    index === activeIndex && "bg-accent text-accent-foreground",
                    option.disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {option.value === value ? (
                      <Check aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : (
                      <span className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    {option.label}
                  </span>
                  {option.description ? (
                    <span className="text-muted-foreground pl-5 text-xs">{option.description}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
