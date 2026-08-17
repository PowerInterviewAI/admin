import "server-only";

import { createHash } from "node:crypto";

import nodemailer, { type Transporter } from "nodemailer";

import { campaignHeartbeatTimeoutMs } from "@/lib/schemas/email";

/**
 * SMTP settings, read from the environment at call time rather than module scope so editing
 * `.env.local` does not need a rebuild to take effect.
 *
 * Nothing here may reach a client: the password is a live API key and the host names the provider.
 * `describeEmailSetup()` below is the only shape the UI ever sees.
 */
export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
  appName: string;
  /** Pause between recipients, holding the run under the provider's rate limit. */
  delayMs: number;
  /** Prefills the composer's test-send box. */
  testAddress: string;
}

const DEFAULT_FROM_ADDRESS = "noreply@vectorleappulse.xyz";
const DEFAULT_FROM_NAME = "Power Interview AI Team";
const DEFAULT_APP_NAME = "Power Interview AI";
const DEFAULT_DELAY_MS = 1000;
const IMPLICIT_TLS_PORT = 465;

export type EmailConfigResult = { ok: true; config: EmailConfig } | { ok: false; error: string };

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readEmailConfig(): EmailConfigResult {
  const host = process.env.SMTP_HOST?.trim() ?? "";
  const user = process.env.SMTP_EMAIL?.trim() ?? "";
  const password = process.env.SMTP_PASSWORD ?? "";
  const port = readNumber(process.env.SMTP_PORT, 0);

  const missing = [
    host ? null : "SMTP_HOST",
    port ? null : "SMTP_PORT",
    user ? null : "SMTP_EMAIL",
    password ? null : "SMTP_PASSWORD",
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Email sending is not configured: ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } missing from .env.local`,
    };
  }

  return {
    ok: true,
    config: {
      host,
      port,
      user,
      password,
      fromAddress: process.env.EMAIL_FROM_ADDRESS?.trim() || DEFAULT_FROM_ADDRESS,
      fromName: process.env.EMAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
      appName: process.env.APP_NAME?.trim() || DEFAULT_APP_NAME,
      delayMs: readNumber(process.env.EMAIL_SEND_DELAY_MS, DEFAULT_DELAY_MS),
      testAddress: process.env.EMAIL_TEST_ADDRESS?.trim() ?? "",
    },
  };
}

/**
 * How stale a campaign's heartbeat has to be before it counts as interrupted, given the pace this
 * install actually sends at. Falls back to the default pace when SMTP is unconfigured, which is
 * the only state in which no campaign can be running anyway.
 */
export function heartbeatTimeoutMs(): number {
  const result = readEmailConfig();
  return campaignHeartbeatTimeoutMs(result.ok ? result.config.delayMs : DEFAULT_DELAY_MS);
}

/** Everything about the mail setup that is safe to render in the browser. */
export interface EmailSetup {
  configured: boolean;
  error: string | null;
  fromAddress: string;
  fromName: string;
  appName: string;
  host: string;
  delayMs: number;
  testAddress: string;
}

export function describeEmailSetup(): EmailSetup {
  const result = readEmailConfig();

  if (!result.ok) {
    return {
      configured: false,
      error: result.error,
      fromAddress: DEFAULT_FROM_ADDRESS,
      fromName: DEFAULT_FROM_NAME,
      appName: process.env.APP_NAME?.trim() || DEFAULT_APP_NAME,
      host: "",
      delayMs: DEFAULT_DELAY_MS,
      testAddress: process.env.EMAIL_TEST_ADDRESS?.trim() ?? "",
    };
  }

  const { config } = result;
  return {
    configured: true,
    error: null,
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    appName: config.appName,
    host: config.host,
    delayMs: config.delayMs,
    testAddress: config.testAddress,
  };
}

declare global {
  var __adminMailTransport: { key: string; transporter: Transporter } | undefined;
}

/**
 * Includes the credential, because a pooled transporter fixes its `auth` at creation. Keying on
 * host/port/user alone meant a rotated Resend key kept failing against the old one until the
 * process restarted - which contradicts `readEmailConfig` reading the environment at call time so
 * that editing `.env.local` takes effect without a rebuild.
 *
 * Hashed rather than concatenated: the key lives on `globalThis` for the life of the process, and
 * there is no reason to keep a second plaintext copy of an API key there.
 */
function transportKey(config: EmailConfig): string {
  const secret = createHash("sha256").update(config.password).digest("hex");
  return `${config.host}:${config.port}:${config.user}:${secret}`;
}

/**
 * One pooled transporter per process, cached on `globalThis` for the same reason the Mongo client
 * is: Next re-evaluates modules on every edit in development, and a module-scoped transporter
 * would leak a connection pool per reload.
 *
 * `maxConnections: 1` is deliberate. Campaigns send one recipient at a time behind a delay, so a
 * wider pool would only add idle sockets while making the provider's rate limit easier to trip.
 */
export function getTransporter(config: EmailConfig): Transporter {
  const key = transportKey(config);
  const cached = globalThis.__adminMailTransport;

  if (cached && cached.key === key) {
    return cached.transporter;
  }

  cached?.transporter.close();

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; anything else negotiates STARTTLS after connecting.
    secure: config.port === IMPLICIT_TLS_PORT,
    auth: { user: config.user, pass: config.password },
    pool: true,
    maxConnections: 1,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  });

  globalThis.__adminMailTransport = { key, transporter };
  return transporter;
}

export interface SendEmailArgs {
  config: EmailConfig;
  toEmail: string;
  toName: string;
  subject: string;
  html: string;
}

/**
 * Sends one message and lets failures propagate.
 *
 * Backend and the Python bulk sender both swallow every SMTP exception into a log line, which is
 * why neither can say afterwards who actually received a campaign. Here the caller records the
 * failure against the recipient, so the reason survives in the campaign document.
 */
export async function sendEmail({
  config,
  toEmail,
  toName,
  subject,
  html,
}: SendEmailArgs): Promise<void> {
  const transporter = getTransporter(config);

  await transporter.sendMail({
    from: { name: config.fromName, address: config.fromAddress },
    to: { name: toName, address: toEmail },
    subject,
    html,
  });
}

/** Opens a connection and authenticates without sending, so a bad key fails before any recipient. */
export async function verifyTransport(config: EmailConfig): Promise<void> {
  await getTransporter(config).verify();
}

interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

/**
 * Turns a driver-level failure into something an admin can act on. The generic nodemailer message
 * for a bad Resend key is `Invalid login: 535 ...`, which does not say which of the four settings
 * to go and look at.
 */
export function describeSmtpError(error: unknown): string {
  const smtp = error as SmtpError;

  switch (smtp?.code) {
    case "EAUTH":
      return "SMTP authentication failed. Check SMTP_EMAIL and SMTP_PASSWORD in .env.local.";
    case "ECONNECTION":
    case "ESOCKET":
      return "Could not reach the SMTP server. Check SMTP_HOST, SMTP_PORT, and your firewall.";
    case "ETIMEDOUT":
    case "ECONNRESET":
      return "The SMTP server did not respond in time.";
    case "EENVELOPE":
      return smtp.response ?? "The SMTP server rejected the sender or recipient address.";
    default:
      return smtp?.response ?? smtp?.message ?? String(error);
  }
}
