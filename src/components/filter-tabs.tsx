"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import { type ListTab, type ListTabCounts, activeTabValue, tabPatch } from "@/lib/list-tabs";

interface FilterTabsProps<P extends object> {
  tabs: readonly ListTab<P>[];
  params: P;
  /** Rows behind each tab, counted against the view's other filters. Omit to render bare labels. */
  counts?: ListTabCounts;
  onSelect: (patch: Partial<P>) => void;
}

/**
 * Quick filters as a segmented control, driven by the URL like every other filter here - so a tab
 * is linkable, the back button steps through tabs, and the strip stays correct when a filter below
 * it happens to select the same rows.
 *
 * The active tab is derived from the params rather than held in state, which means no tab is active
 * when the filter row has been set to something no tab offers. That is deliberate: highlighting a
 * tab whose filter is not the one in force would be a lie about what the table is showing.
 */
export function FilterTabs<P extends object>({
  tabs,
  params,
  counts,
  onSelect,
}: FilterTabsProps<P>) {
  return (
    <Tabs
      className="pb-4"
      value={activeTabValue(tabs, params)}
      onValueChange={(value, details) => {
        // Only user-initiated changes carry `none`. A controlled root emits nothing else today, but
        // an automatic fallback writing params would be a navigation nobody asked for.
        if (details.reason !== "none") return;
        const tab = tabs.find((candidate) => candidate.value === value);
        if (tab) onSelect(tabPatch(tabs, tab));
      }}
    >
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="px-3">
            {tab.label}
            {counts && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatNumber(counts[tab.value] ?? 0)}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
