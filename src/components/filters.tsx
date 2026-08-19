"use client";

import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { titleCase } from "@/lib/format";

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
            not in a statically-known `items` array. */}
        <SelectValue>{(current: string) => (current === ALL ? allLabel : titleCase(current))}</SelectValue>
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
