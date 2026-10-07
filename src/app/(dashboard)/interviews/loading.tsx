import { TablePageSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return <TablePageSkeleton columns={6} filters={4} tabs={4} />;
}
