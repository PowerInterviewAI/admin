"use client";

import { Download } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionData } from "@/lib/action-result";
import { CSV_BOM } from "@/lib/csv";
import { formatNumber } from "@/lib/format";
import type { CsvExport } from "@/server/actions/exports";

/**
 * Saves the *filtered* result set, not the page on screen. Serializing the visible rows in the
 * browser would be less code and the wrong feature: an admin exporting "failed payments this month"
 * wants all of them, and would have no way to tell that they got the first twenty.
 */
export function ExportButton({
  run,
  label = "Export CSV",
}: {
  run: () => Promise<ActionData<CsvExport>>;
  label?: string;
}) {
  const [isExporting, startExport] = useTransition();

  const onClick = () => {
    startExport(async () => {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { csv, filename, rows, truncated } = result.data;
      if (rows === 0) {
        toast.error("Nothing matches these filters, so there is nothing to export");
        return;
      }

      const blob = new Blob([CSV_BOM + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      if (truncated) {
        toast.warning(
          `Exported the first ${formatNumber(rows)} rows. Narrow the filters to get the rest.`,
        );
      } else {
        toast.success(`Exported ${formatNumber(rows)} rows`);
      }
    });
  };

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={isExporting}>
      <Download data-icon="inline-start" />
      {isExporting ? "Exporting..." : label}
    </Button>
  );
}
