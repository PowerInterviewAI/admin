import { LiveRefresh } from "@/components/live-refresh";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

/**
 * Every dashboard page renders this, which is why the auto-refresh lives here rather than in the
 * layout: a layout is not re-rendered on a navigation between its pages, so a timestamp taken
 * there would describe the page before this one.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  // A server component renders once per request and never re-renders, so the instability the
  // purity rule guards against cannot happen here - and the clock at render is the value wanted.
  // eslint-disable-next-line react-hooks/purity
  const renderedAt = Date.now();

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center gap-2">
        <LiveRefresh at={renderedAt} />
        {actions}
      </div>
    </div>
  );
}
