import type { UserLabel } from "@/lib/schemas/common";

/** Renders who a row belongs to. Falls back to the raw id when the user no longer exists. */
export function UserCell({ user, userId }: { user: UserLabel | null; userId: string }) {
  if (!user) {
    return (
      <div className="flex flex-col">
        <span className="text-muted-foreground italic">Deleted user</span>
        <span className="font-mono text-xs text-muted-foreground">{userId}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <span className="font-medium">{user.username}</span>
      <span className="text-xs text-muted-foreground">{user.email}</span>
    </div>
  );
}
