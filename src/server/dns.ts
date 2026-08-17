import "server-only";

import dns from "node:dns";

const FALLBACK_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];

let applied = false;

/**
 * Node resolves names two independent ways: `dns.lookup` goes through the OS resolver, while
 * `dns.resolve*` goes through c-ares, configured by `dns.getServers()`. The MongoDB driver expands
 * a `mongodb+srv://` URI with `resolveSrv`/`resolveTxt` and only then connects with `lookup`, so a
 * broken c-ares config fails as `querySrv ECONNREFUSED` even though the network and Atlas are fine.
 *
 * c-ares falls back to a built-in `127.0.0.1` whenever it cannot read the system DNS config, which
 * happens on this machine (Astrill VPN plus VMware virtual adapters). Nothing listens on port 53
 * locally, so every c-ares query is refused. Pointing it at real resolvers is the entire fix, and
 * the loopback check keeps this a no-op wherever DNS is configured correctly.
 *
 * This runs on client creation rather than from `instrumentation.ts` because resolver config is
 * per-process and in dev Next renders routes in a worker separate from the one running `register()`.
 */
export function ensureResolvableDns(): void {
  if (applied) return;
  applied = true;

  // `dns` and `dns.promises` hold separate resolvers, so both have to be read and both have to be
  // set. Fixing only the callback API leaves the driver, which resolves through `dns.promises`,
  // still pointed at the unusable server.
  if (isUsable(dns.getServers()) && isUsable(dns.promises.getServers())) return;

  const servers = (process.env.DNS_SERVERS ?? FALLBACK_DNS_SERVERS.join(","))
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);

  if (servers.length === 0) return;

  try {
    dns.setServers(servers);
    dns.promises.setServers(servers);
    console.warn(
      `[dns] Node's resolver could not answer the SRV lookup a mongodb+srv:// URL needs. ` +
        `Using ${servers.join(", ")} instead; override with DNS_SERVERS in .env.local.`,
    );
  } catch (error) {
    console.error(`[dns] DNS_SERVERS is not a usable resolver list: ${String(error)}`);
  }
}

function isUsable(servers: string[]): boolean {
  return servers.length > 0 && !servers.every(isLoopback);
}

/** `getServers()` returns RFC 5952 strings, with a `:port` suffix only when a custom port is set. */
function isLoopback(server: string): boolean {
  const host = server.startsWith("[")
    ? server.slice(1, server.indexOf("]"))
    : // A bare IPv6 address has several colons; a single one separates an IPv4 address from its port.
      server.split(":").length === 2
      ? server.slice(0, server.indexOf(":"))
      : server;
  return host.startsWith("127.") || host === "::1";
}
