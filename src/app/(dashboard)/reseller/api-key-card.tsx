"use client";

import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import type { ApiKeyStatus } from "@/lib/schemas/reseller";
import { revokeOwnApiKey, rotateOwnApiKey } from "@/server/actions/resellers";

/**
 * Issue, rotate and revoke the reseller's own key.
 *
 * A new key is shown exactly once, in a dialog that has to be dismissed on purpose: only its digest
 * is stored, so closing the dialog is the last chance to copy it. The key lives in component state
 * for that dialog and nowhere else - not in the URL, not in storage.
 */
export function ApiKeyCard({
  status,
  lastSaleAt,
}: {
  status: ApiKeyStatus;
  lastSaleAt: number | null;
}) {
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const [isWorking, startWorking] = useTransition();

  const hasKey = status.prefix !== null;

  const issue = () => {
    startWorking(async () => {
      const result = await rotateOwnApiKey();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirm(null);
      setCopied(false);
      setNewKey(result.data.key);
    });
  };

  const revoke = () => {
    startWorking(async () => {
      const result = await revokeOwnApiKey();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirm(null);
      toast.success("Key revoked. Your app can no longer call the API.");
    });
  };

  const copy = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      toast.error("Could not copy. Select the key and copy it by hand.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          API key
        </CardTitle>
        <CardDescription>
          Your app sends this as the <code className="font-mono">X-API-Key</code> header. Keep it on
          your server, never in a browser or a mobile app.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasKey ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2 flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Key</span>
              <span className="font-mono">{status.prefix}...</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Issued</span>
              <span>{formatDate(status.created_at)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {/* Not "last used": reads are not recorded, only sales. */}
              <span className="text-xs text-muted-foreground">Last sale</span>
              <span>{formatDate(lastSaleAt)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You have no key yet. Generate one to connect your app.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {hasKey ? (
            <>
              <AlertDialog
                open={confirm === "rotate"}
                onOpenChange={(open) => setConfirm(open ? "rotate" : null)}
              >
                <AlertDialogTrigger render={<Button variant="outline" />}>Rotate key</AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Rotate your API key?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your current key stops working immediately. Update your app with the new key
                      straight away, or its calls will fail.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={isWorking} onClick={issue}>
                      {isWorking ? "Rotating..." : "Rotate"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog
                open={confirm === "revoke"}
                onOpenChange={(open) => setConfirm(open ? "revoke" : null)}
              >
                <AlertDialogTrigger render={<Button variant="destructive" />}>Revoke</AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke your API key?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your app stops working until you generate a new key. Use this if the key may
                      have leaked.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={isWorking} onClick={revoke}>
                      {isWorking ? "Revoking..." : "Revoke"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : (
            <Button disabled={isWorking} onClick={issue}>
              {isWorking ? "Generating..." : "Generate key"}
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={newKey !== null} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              Copy it now. It is shown this once and cannot be recovered: if you lose it, rotate to
              get a new one.
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm select-all">
            {newKey}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={copy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Copied" : "Copy key"}
            </Button>
            <Button onClick={() => setNewKey(null)}>I have saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
