"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, CircleX, FileCode2, Send, TriangleAlert, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { type Control, Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  EMAIL_ACCENTS,
  EMAIL_TEMPLATE_HINTS,
  PREVIEW_RECIPIENT_NAME,
  STARTER_EMAIL_BODY,
  renderEmailHtml,
} from "@/lib/email/template";
import { formatNumber, titleCase } from "@/lib/format";
import {
  EMAIL_AUDIENCE_LABELS,
  EMAIL_TEMPLATES,
  type EmailAudience,
  type EmailCampaignProgress,
  type EmailMessage,
  type EmailTemplate,
  type RecipientOption,
  emailMessageSchema,
} from "@/lib/schemas/email";
import {
  getCampaignProgress,
  sendTestEmail,
  startEmailCampaign,
} from "@/server/actions/email-campaigns";
import type { EmailSetup } from "@/server/email/transport";

import { EmailPreview } from "./email-preview";
import { RecipientPicker } from "./recipient-picker";
import { SendConfirmDialog } from "./send-confirm-dialog";

const AUDIENCES: EmailAudience[] = ["one", "selected", "all"];
const POLL_INTERVAL_MS = 1500;

interface EmailComposerProps {
  setup: EmailSetup;
  mailableCount: number;
  initialRecipients: RecipientOption[];
  /** Passed from the server so the preview's footer year cannot differ between the two renders. */
  year: number;
}

export function EmailComposer({
  setup,
  mailableCount,
  initialRecipients,
  year,
}: EmailComposerProps) {
  const router = useRouter();

  const [audience, setAudience] = useState<EmailAudience>("one");
  const [selected, setSelected] = useState<RecipientOption[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<EmailCampaignProgress | null>(null);
  const [testAddress, setTestAddress] = useState(setup.testAddress);

  const [isStarting, startSending] = useTransition();
  const [isTesting, startTesting] = useTransition();

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cleanup only. No state is written here, which keeps this clear of the project's ban on
  // set-state-in-effect; polling itself is kicked off from the send handler.
  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const {
    register,
    control,
    trigger,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<EmailMessage>({
    resolver: zodResolver(emailMessageSchema),
    defaultValues: { subject: "", template: "info", body: "" },
  });

  const recipientCount = audience === "all" ? mailableCount : selected.length;
  const isRunning = progress?.status === "sending";

  const poll = useCallback(
    (campaignId: string) => {
      const tick = async () => {
        const result = await getCampaignProgress(campaignId);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }

        setProgress(result.data);

        if (result.data.status === "sending") {
          pollTimer.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
          return;
        }

        if (result.data.failed_count === 0) {
          toast.success(`Sent to ${formatNumber(result.data.sent_count)} recipients`);
        } else {
          toast.warning(
            `${formatNumber(result.data.sent_count)} sent, ${formatNumber(
              result.data.failed_count,
            )} failed`,
          );
        }
        // Brings the recent-sends list on this page up to date without losing what is typed.
        router.refresh();
      };

      pollTimer.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
    },
    [router],
  );

  const onSendTest = () => {
    startTesting(async () => {
      if (!(await trigger())) {
        toast.error("Finish the message before sending a test");
        return;
      }
      const result = await sendTestEmail({ ...getValues(), to: testAddress });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Test sent to ${testAddress}`);
    });
  };

  const onRequestSend = async () => {
    if (!(await trigger())) {
      toast.error("Finish the message before sending");
      return;
    }
    if (recipientCount === 0) {
      toast.error("Pick at least one recipient");
      return;
    }
    setConfirmOpen(true);
  };

  const onConfirmSend = () => {
    startSending(async () => {
      const result = await startEmailCampaign({
        ...getValues(),
        audience,
        user_ids: audience === "all" ? [] : selected.map((option) => option.id),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      setProgress(result.data);
      poll(result.data.id);
    });
  };

  return (
    <>
      {!setup.configured && setup.error && (
        <Card className="mb-4 border border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Sending is disabled</p>
              <p className="text-sm text-muted-foreground">{setup.error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Message</CardTitle>
              <CardDescription>
                The layout adds the greeting, the sign-off, and the footer around this.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* No <form> element: nothing here submits on Enter, and sending runs through a
                  confirmation dialog rather than a submit button. */}
              <FieldGroup>
                <Field data-invalid={!!errors.subject}>
                  <FieldLabel htmlFor="campaign-subject">Subject</FieldLabel>
                  <Input
                    id="campaign-subject"
                    placeholder="What's new in Power Interview AI"
                    autoComplete="off"
                    aria-invalid={!!errors.subject}
                    {...register("subject")}
                  />
                  <FieldDescription>
                    Also rendered as the heading at the top of the email.
                  </FieldDescription>
                  <FieldError errors={[errors.subject]} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="campaign-template">Style</FieldLabel>
                  <Controller
                    control={control}
                    name="template"
                    render={({ field }) => (
                      <>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="campaign-template" className="w-full">
                            {/* Without a formatter children function the closed trigger renders
                                blank for anything not in a statically-known items array. */}
                            <SelectValue>
                              {(value: string) => (
                                <TemplateOption template={value as EmailTemplate} />
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {EMAIL_TEMPLATES.map((option) => (
                              <SelectItem key={option} value={option}>
                                <TemplateOption template={option} />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldDescription>{EMAIL_TEMPLATE_HINTS[field.value]}</FieldDescription>
                      </>
                    )}
                  />
                </Field>

                <Field data-invalid={!!errors.body}>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="campaign-body">Body (HTML)</FieldLabel>
                    {/* Offered rather than pre-filled: a body that starts as placeholder copy is a
                        body that can be sent as placeholder copy. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isRunning}
                      onClick={() =>
                        setValue("body", STARTER_EMAIL_BODY, {
                          shouldValidate: true,
                          shouldDirty: true,
                        })
                      }
                    >
                      <FileCode2 data-icon="inline-start" />
                      Insert starter layout
                    </Button>
                  </div>
                  <Textarea
                    id="campaign-body"
                    rows={16}
                    spellCheck={false}
                    placeholder="<p>Something worth telling everyone.</p>"
                    // The base Textarea is `field-sizing-content`, which re-measures the entire
                    // body on every keystroke and grows the page unbounded. A campaign body is
                    // long enough for both to hurt, so this box is a fixed 16 rows that scrolls.
                    className="field-sizing-fixed resize-y overflow-y-auto font-mono text-xs"
                    aria-invalid={!!errors.body}
                    {...register("body")}
                  />
                  <FieldDescription>
                    Inline styles only, absolute URLs, no greeting and no sign-off - the layout
                    renders both. Email clients drop{" "}
                    <code className="font-mono">&lt;style&gt;</code> blocks and cannot lay out
                    flexbox.
                  </FieldDescription>
                  <FieldError errors={[errors.body]} />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recipients</CardTitle>
              <CardDescription>
                Only active users with an email address can be reached.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs
                value={audience}
                onValueChange={(value) => {
                  const next = value as EmailAudience;
                  setAudience(next);
                  // A single-recipient audience cannot inherit a multi-select, and carrying a
                  // stale pick into "all" would misreport the count.
                  setSelected((current) => (next === "selected" ? current : current.slice(0, 1)));
                }}
              >
                <TabsList className="w-full">
                  {AUDIENCES.map((option) => (
                    <TabsTrigger key={option} value={option} disabled={isRunning}>
                      {EMAIL_AUDIENCE_LABELS[option]}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="one" className="pt-4">
                  <RecipientPicker
                    audience="one"
                    initialOptions={initialRecipients}
                    selected={selected}
                    onSelectedChange={setSelected}
                    disabled={isRunning}
                  />
                </TabsContent>

                <TabsContent value="selected" className="pt-4">
                  <RecipientPicker
                    audience="selected"
                    initialOptions={initialRecipients}
                    selected={selected}
                    onSelectedChange={setSelected}
                    disabled={isRunning}
                  />
                </TabsContent>

                <TabsContent value="all" className="pt-4">
                  <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
                    <Users className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium">
                        {formatNumber(mailableCount)} active{" "}
                        {mailableCount === 1 ? "user" : "users"} will receive this
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Resolved when you press send, not now, so anyone who signs up in the
                        meantime is included. Duplicate addresses are collapsed to one message.
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {progress ? (
            <CampaignProgressCard progress={progress} onDismiss={() => setProgress(null)} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Send</CardTitle>
                <CardDescription>
                  Test it in a real inbox first. The preview cannot show how a client renders it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field orientation="responsive">
                    <Input
                      type="email"
                      aria-label="Test address"
                      placeholder="you@example.com"
                      autoComplete="off"
                      value={testAddress}
                      onChange={(event) => setTestAddress(event.target.value)}
                      disabled={!setup.configured}
                    />
                    <Button
                      variant="outline"
                      className="shrink-0"
                      disabled={!setup.configured || !testAddress || isTesting}
                      onClick={onSendTest}
                    >
                      {isTesting ? "Sending..." : "Send test"}
                    </Button>
                  </Field>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <p className="text-sm text-muted-foreground">
                      {recipientCount === 0
                        ? "No recipients picked yet"
                        : `${formatNumber(recipientCount)} ${
                            recipientCount === 1 ? "recipient" : "recipients"
                          } - ${EMAIL_AUDIENCE_LABELS[audience].toLowerCase()}`}
                    </p>
                    <Button
                      disabled={!setup.configured || recipientCount === 0 || isStarting}
                      onClick={onRequestSend}
                    >
                      <Send data-icon="inline-start" />
                      Send campaign
                    </Button>
                  </div>
                </FieldGroup>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="xl:sticky xl:top-0">
          <PreviewPane
            control={control}
            appName={setup.appName}
            fromName={setup.fromName}
            fromAddress={setup.fromAddress}
            year={year}
          />
        </div>
      </div>

      <SendConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        audience={audience}
        recipientCount={recipientCount}
        // Read rather than watched: this only renders once the dialog opens, and a watch would
        // re-render the whole composer on every keystroke to keep a string nobody is reading yet.
        subject={getValues("subject")}
        delayMs={setup.delayMs}
        isSending={isStarting}
        onConfirm={onConfirmSend}
      />
    </>
  );
}

/**
 * Subscribes to the message fields on its own, so typing re-renders the preview and nothing else -
 * the recipient picker in particular keeps its search results and scroll position.
 */
function PreviewPane({
  control,
  appName,
  fromName,
  fromAddress,
  year,
}: {
  control: Control<EmailMessage>;
  appName: string;
  fromName: string;
  fromAddress: string;
  year: number;
}) {
  const subject = useWatch({ control, name: "subject" });
  const body = useWatch({ control, name: "body" });
  const template = useWatch({ control, name: "template" });

  // Building the string is cheap; painting it is not. The expensive half is debounced inside
  // `EmailPreview`, which is why there is no `useDeferredValue` here - it would only add a second
  // render per keystroke without skipping any of the work that actually costs.
  const html = useMemo(
    () =>
      renderEmailHtml({
        appName,
        name: PREVIEW_RECIPIENT_NAME,
        subject,
        body,
        template,
        year,
      }),
    [appName, subject, body, template, year],
  );

  return (
    <EmailPreview html={html} subject={subject} fromName={fromName} fromAddress={fromAddress} />
  );
}

function TemplateOption({ template }: { template: EmailTemplate }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-2.5 rounded-full"
        style={{ backgroundColor: EMAIL_ACCENTS[template] }}
      />
      {titleCase(template)}
    </span>
  );
}

function CampaignProgressCard({
  progress,
  onDismiss,
}: {
  progress: EmailCampaignProgress;
  onDismiss: () => void;
}) {
  const done = progress.sent_count + progress.failed_count;
  const percent = progress.total === 0 ? 0 : Math.round((done / progress.total) * 100);
  const isRunning = progress.status === "sending";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isRunning ? (
            "Sending"
          ) : progress.failed_count === 0 ? (
            <>
              <CircleCheck className="size-4 text-emerald-600" />
              Campaign sent
            </>
          ) : (
            <>
              <CircleX className="size-4 text-destructive" />
              Campaign finished with failures
            </>
          )}
        </CardTitle>
        <CardDescription>
          {isRunning
            ? "Sending continues even if you navigate away from this page."
            : "The full delivery log is in the campaign history."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Campaign progress"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline">
            {formatNumber(done)} of {formatNumber(progress.total)}
          </Badge>
          <Badge variant="secondary">{formatNumber(progress.sent_count)} sent</Badge>
          {progress.failed_count > 0 && (
            <Badge variant="destructive">{formatNumber(progress.failed_count)} failed</Badge>
          )}
        </div>

        {progress.error && <p className="text-sm text-destructive">{progress.error}</p>}

        {!isRunning && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onDismiss}>
              Compose another
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
