import "server-only";

import { LiveRefresh } from "@/components/live-refresh";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Off for a page that is itself a form - see `LiveRefresh`. */
  autoRefresh?: boolean;
}

/**
 * Every dashboard page renders this, which is why the auto-refresh lives here rather than in the
 * layout: a layout is not re-rendered on a navigation between its pages, so a timestamp taken
 * there would describe the page before this one.
 */
export function PageHeader({ title, description, actions, autoRefresh }: PageHeaderProps) {
  // A server component renders once per request and never re-renders, so the instability the
  // purity rule guards against cannot happen here - and the clock at render is the value wanted.
  // `server-only` above is what keeps that true: rendered by a client component, this would run
  // again in the browser and hydrate against a different time.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center gap-2">
        <LiveRefresh at={renderedAt} auto={autoRefresh} />
        {actions}
      </div>
    </div>
  );
}
