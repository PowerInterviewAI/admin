"use client";

import { CalendarRange, FilterX, X } from "lucide-react";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { titleCase } from "@/lib/format";
import { PAGE_SIZE_OPTIONS } from "@/lib/search-params";
import { cn } from "@/lib/utils";

/** Base UI's Select needs a real string value, so "no filter" travels as an explicit sentinel. */
const ALL = "all";

interface FilterSelectProps<T extends string> {
  label: string;
  allLabel: string;
  value: T | undefined;
  options: readonly T[];
  onChange: (value: T | undefined) => void;
  className?: string;
  formatOption?: (value: T) => string;
}

export function FilterSelect<T extends string>({
  label,
  allLabel,
  value,
  options,
  onChange,
  className,
  formatOption = titleCase as (value: T) => string,
}: FilterSelectProps<T>) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next: string | null) =>
        onChange(next === null || next === ALL ? undefined : (next as T))
      }
    >
      <SelectTrigger className={className} aria-label={label}>
        {/* Without a formatter children function, the closed trigger renders blank for anything
            not in a statically-known `items` array - and the formatter is called with `null` during
            transient render states, not only with real values, so "no value yet" has to land on the
            same label as the explicit sentinel. */}
        <SelectValue>
          {(current: string | null) =>
            current === null || current === ALL ? allLabel : formatOption(current as T)
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {formatOption(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface SearchInputProps {
  label: string;
  placeholder: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  delayMs?: number;
  className?: string;
}

/**
 * Uncontrolled on purpose. Keeping the box in React state would need an effect to resync it when
 * the URL changes underneath, which this project's eslint config rejects
 * (`react-hooks/set-state-in-effect`) - and there is nothing to resync to in practice, because
 * search writes with `replace`, so it never creates a history entry to navigate back through.
 */
export function SearchInput({
  label,
  placeholder,
  value,
  onChange,
  delayMs = 300,
  className,
}: SearchInputProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Uncontrolled means `defaultValue` is only read on the first render, but Base UI reads it as a
  // FieldControl default and warns when it changes identity afterwards - and it does change here:
  // the debounced write puts the term in the URL, which comes straight back down as a new `value`.
  // Latching it in state - never set again - keeps the prop stable and costs nothing, because what
  // the box shows from then on is whatever was typed into it.
  const [initialValue] = useState(() => value ?? "");

  return (
    <Input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      defaultValue={initialValue}
      className={className}
      onChange={(event) => {
        const next = event.target.value.trim();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(next || undefined), delayMs);
      }}
    />
  );
}

interface DateFilterProps {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  className?: string;
}

export function DateFilter({ label, value, onChange, className }: DateFilterProps) {
  return (
    <Input
      type="date"
      aria-label={label}
      value={value ?? ""}
      className={className}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

/**
 * `toISOString()` would format the *UTC* calendar day, which is the day before local anywhere west
 * of Greenwich for most of the evening - so "last 7 days" would silently ask for a window ending
 * yesterday. The server reads these strings back as local days too (`dayRangeMs`).
 */
function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return toDateInput(date);
}

const RANGE_PRESETS = [
  { label: "Today", days: 0 },
  { label: "Last 7 days", days: 6 },
  { label: "Last 30 days", days: 29 },
  { label: "Last 90 days", days: 89 },
] as const;

interface DateRangeFilterProps {
  fromLabel?: string;
  toLabel?: string;
  from: string | undefined;
  to: string | undefined;
  onChange: (range: { from: string | undefined; to: string | undefined }) => void;
  className?: string;
}

/**
 * Two date inputs plus presets, writing both ends in one navigation. Setting them separately would
 * cost two server round trips for one intent, and the intermediate state (a `from` later than the
 * old `to`) matches nothing.
 */
export function DateRangeFilter({
  fromLabel = "From date",
  toLabel = "To date",
  from,
  to,
  onChange,
  className,
}: DateRangeFilterProps) {
  const active = from || to;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" aria-label="Date range presets" />}
        >
          <CalendarRange data-icon="inline-start" />
          Range
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-auto min-w-40">
          {RANGE_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.label}
              onClick={() => onChange({ from: daysAgo(preset.days), to: toDateInput(new Date()) })}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            disabled={!active}
            onClick={() => onChange({ from: undefined, to: undefined })}
          >
            All time
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DateFilter
        label={fromLabel}
        value={from}
        onChange={(next) => onChange({ from: next, to })}
        className="w-38"
      />
      <span className="text-sm text-muted-foreground">to</span>
      <DateFilter
        label={toLabel}
        value={to}
        onChange={(next) => onChange({ from, to: next })}
        className="w-38"
      />
    </div>
  );
}

interface NumberRangeFilterProps {
  label: string;
  minPlaceholder?: string;
  maxPlaceholder?: string;
  min: number | undefined;
  max: number | undefined;
  step?: string;
  onChange: (range: { min: number | undefined; max: number | undefined }) => void;
  className?: string;
}

/**
 * Debounced like the search box and uncontrolled for the same reason: a number typed digit by digit
 * would otherwise navigate once per keystroke, and "1" on the way to "150" is a filter that matches
 * almost nothing.
 */
export function NumberRangeFilter({
  label,
  minPlaceholder = "Min",
  maxPlaceholder = "Max",
  min,
  max,
  step,
  onChange,
  className,
}: NumberRangeFilterProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initial] = useState(() => ({ min: min?.toString() ?? "", max: max?.toString() ?? "" }));

  // Seeded once and never resynced from props, for the same reason `SearchInput` is uncontrolled:
  // what these boxes hold from the first keystroke on is whatever was typed into them.
  const pending = useRef<{ min: number | undefined; max: number | undefined }>({ min, max });

  const push = (side: "min" | "max", raw: string) => {
    const parsed = raw === "" ? undefined : Number(raw);
    pending.current = {
      ...pending.current,
      [side]: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    };
    const next = pending.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), 500);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        aria-label={`${label} minimum`}
        placeholder={minPlaceholder}
        defaultValue={initial.min}
        className="w-24"
        onChange={(event) => push("min", event.target.value)}
      />
      <span className="text-sm text-muted-foreground">-</span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        aria-label={`${label} maximum`}
        placeholder={maxPlaceholder}
        defaultValue={initial.max}
        className="w-24"
        onChange={(event) => push("max", event.target.value)}
      />
    </div>
  );
}

export function PageSizeSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next: string | null) => next && onChange(Number(next))}
    >
      <SelectTrigger className="h-8 w-24" aria-label="Rows per page">
        <SelectValue>{(current: string) => `${current} rows`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {PAGE_SIZE_OPTIONS.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {size} rows
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A filter that has no control of its own because nothing in this view sets it - `user_id` arrives
 * from a link on another page. Without something on screen saying so, the list looks like the whole
 * collection with most of it mysteriously missing.
 */
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2">
      {label}
      <Button
        variant="ghost"
        size="icon"
        className="size-5"
        aria-label={`Clear ${label}`}
        onClick={onClear}
      >
        <X className="size-3" />
      </Button>
    </Badge>
  );
}

/**
 * The filter row. Holds the reset control so every list view offers it in the same place and shows
 * the same count - an admin who has scrolled past the controls still has a way to tell that four
 * filters are narrowing what they are looking at.
 */
export function FilterBar({
  children,
  activeCount,
  onReset,
}: {
  children: React.ReactNode;
  activeCount: number;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pb-4">
      {children}
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <FilterX data-icon="inline-start" />
          Reset
          <Badge variant="secondary" className="ml-1">
            {activeCount}
          </Badge>
        </Button>
      )}
    </div>
  );
}
