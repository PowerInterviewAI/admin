"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import type { z } from "zod";

import { buildQueryString } from "@/lib/search-params";

interface SetParamsOptions {
  /** Use for high-frequency controls (a search box) so typing does not fill the back stack. */
  replace?: boolean;
}

/**
 * Filters, sort, and page live in the URL, so the server component re-renders with fresh rows and
 * a view stays linkable. Writing through `startTransition` keeps the current rows on screen while
 * the next page streams in, and surfaces `isPending` so the table can dim instead of flashing.
 */
export function useListParams<Schema extends z.ZodObject>(
  schema: Schema,
  params: z.infer<Schema>,
) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const setParams = useCallback(
    (patch: Partial<z.infer<Schema>>, options: SetParamsOptions = {}) => {
      // Any change other than an explicit page jump returns to page 1: page 3 of the old filter
      // is not page 3 of the new one.
      const next = { ...params, ...patch, page: patch.page ?? 1 };
      const href = `${pathname}${buildQueryString(schema, next)}`;

      startTransition(() => {
        if (options.replace) {
          router.replace(href, { scroll: false });
        } else {
          router.push(href, { scroll: false });
        }
      });
    },
    [params, pathname, router, schema],
  );

  return { setParams, isPending };
}
