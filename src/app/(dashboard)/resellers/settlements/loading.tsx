import { TablePageSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return <TablePageSkeleton columns={8} filters={3} tabs={3} />;
}
