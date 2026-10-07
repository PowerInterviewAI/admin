import { TablePageSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return <TablePageSkeleton columns={8} filters={4} tabs={3} />;
}
