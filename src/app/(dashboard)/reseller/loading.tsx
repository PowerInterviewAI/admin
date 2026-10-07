import { TablePageSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return <TablePageSkeleton columns={5} filters={1} tabs={3} />;
}
