import { TablePageSkeleton } from "@/components/table-skeleton";

export default function Loading() {
  return <TablePageSkeleton columns={5} rows={10} filters={5} tabs={5} />;
}
