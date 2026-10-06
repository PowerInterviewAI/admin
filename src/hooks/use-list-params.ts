"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import type { z } from "zod";

import { usePendingNavigation } from "@/components/navigation-progress";
import { buildQueryString, countActiveFilters, withoutFilters } from "@/lib/search-params";

interface SetParamsOptions {
  /** Use for high-frequency controls (a search box) so typing does not fill the back stack. */
  replace?: boolean;
}

/**
 * Filters, sort, and page live in the URL, so the server component re-renders with fresh rows and
 * a view stays linkable. Writing through `startTransition` keeps the current rows on screen while
 * the next page streams in. The pending state is reported to the navigation store, which drives
 * the progress bar and the dim, and returned as `isPending` so the table can stop taking clicks.
 */
export function useListParams<Schema extends z.ZodObject>(
  schema: Schema,
  params: z.infer<Schema>,
) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  usePendingNavigation(isPending);

  const navigate = useCallback(
    (next: Partial<z.infer<Schema>>, options: SetParamsOptions) => {
      const href = `${pathname}${buildQueryString(schema, next)}`;
      startTransition(() => {
        if (options.replace) {
          router.replace(href, { scroll: false });
        } else {
          router.push(href, { scroll: false });
        }
      });
    },
    [pathname, router, schema],
  );

  const setParams = useCallback(
    (patch: Partial<z.infer<Schema>>, options: SetParamsOptions = {}) => {
      // Any change other than an explicit page jump returns to page 1: page 3 of the old filter
      // is not page 3 of the new one.
      navigate({ ...params, ...patch, page: patch.page ?? 1 }, options);
    },
    [navigate, params],
  );

  /**
   * Drops every filter but keeps sort order and rows-per-page. Built by replacement rather than by
   * patching `setParams` with a bag of `undefined`s, because `buildQueryString` would then have to
   * be told which keys the caller meant to erase versus never set.
   */
  const resetFilters = useCallback(() => {
    navigate(withoutFilters(params as Record<string, unknown>) as Partial<z.infer<Schema>>, {});
  }, [navigate, params]);

  const activeFilterCount = useMemo(
    () => countActiveFilters(params as Record<string, unknown>),
    [params],
  );

  return { setParams, resetFilters, activeFilterCount, isPending };
}
