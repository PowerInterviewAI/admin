"use client";

import { Check, Search, Users, X } from "lucide-react";
import { useCallback, useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatNumber } from "@/lib/format";
import type { EmailAudience, RecipientOption } from "@/lib/schemas/email";
import { cn } from "@/lib/utils";
import { findRecipients } from "@/server/actions/email-campaigns";

const SEARCH_DEBOUNCE_MS = 300;

interface RecipientPickerProps {
  /** `one` collapses the selection to the row just clicked; `selected` toggles it. */
  audience: Extract<EmailAudience, "one" | "selected">;
  /** Seeded by the server so the list has rows before anyone types. */
  initialOptions: RecipientOption[];
  selected: RecipientOption[];
  onSelectedChange: (selected: RecipientOption[]) => void;
  disabled?: boolean;
}

export function RecipientPicker({
  audience,
  initialOptions,
  selected,
  onSelectedChange,
  disabled,
}: RecipientPickerProps) {
  const [options, setOptions] = useState(initialOptions);
  const [isSearching, startSearching] = useTransition();
  const [searchError, setSearchError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedIds = new Set(selected.map((option) => option.id));

  const runSearch = useCallback((query: string) => {
    startSearching(async () => {
      const result = await findRecipients(query);
      if (!result.ok) {
        setSearchError(result.error);
        return;
      }
      setSearchError(null);
      setOptions(result.data);
    });
  }, []);

  const toggle = (option: RecipientOption) => {
    if (audience === "one") {
      onSelectedChange(selectedIds.has(option.id) ? [] : [option]);
      return;
    }
    onSelectedChange(
      selectedIds.has(option.id)
        ? selected.filter((entry) => entry.id !== option.id)
        : [...selected, option],
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search recipients"
          placeholder="Search username or email..."
          className="pl-8"
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.trim();
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => runSearch(next), SEARCH_DEBOUNCE_MS);
          }}
        />
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((option) => (
            <Badge key={option.id} variant="secondary" className="h-6 gap-1 pr-1">
              {option.username || option.email}
              <button
                type="button"
                aria-label={`Remove ${option.email}`}
                disabled={disabled}
                className="rounded-full p-0.5 hover:bg-foreground/10 disabled:opacity-50"
                onClick={() => onSelectedChange(selected.filter((entry) => entry.id !== option.id))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          {audience === "selected" && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onSelectedChange([])}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      <div
        className={cn(
          "max-h-64 overflow-y-auto rounded-lg border transition-opacity",
          isSearching && "opacity-60",
        )}
        aria-busy={isSearching}
      >
        {searchError ? (
          <p className="p-4 text-sm text-destructive">{searchError}</p>
        ) : options.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No active users match that search.
          </p>
        ) : (
          <ul>
            {options.map((option) => {
              const isSelected = selectedIds.has(option.id);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={isSelected}
                    onClick={() => toggle(option)}
                    className="flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {audience === "selected" ? (
                      <Checkbox checked={isSelected} tabIndex={-1} className="pointer-events-none" />
                    ) : (
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          isSelected ? "text-primary" : "text-transparent",
                        )}
                      />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{option.username}</span>
                      <span className="truncate text-xs text-muted-foreground">{option.email}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {isSearching ? <Spinner className="size-3" /> : <Users className="size-3" />}
        {audience === "one"
          ? "Only active users with an email address are listed."
          : `${formatNumber(selected.length)} selected. Search narrows the list; the top matches are shown.`}
      </p>
    </div>
  );
}
