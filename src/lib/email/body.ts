/**
 * Handling for the raw HTML an author types into a campaign body.
 *
 * The body is spliced into the shared layout unescaped and the result goes straight to SMTP, so
 * whatever is pasted here is what a recipient's client is asked to render. Two different jobs live
 * in this file:
 *
 * - `normalizeEmailBody` rewrites the one shape that makes the preview *lie* - a complete HTML
 *   document. A browser parser silently discards a nested `<html>`/`<head>`/`<body>`, so the frame
 *   looks correct while the string handed to SMTP still carries them. It runs inside
 *   `renderEmailHtml`, which is what keeps the preview and the send byte-identical.
 * - `inspectEmailBody` reports what will render here but not in an inbox. It only describes; it
 *   never rewrites, because an email body is hand-tuned HTML and quietly "fixing" it would be a
 *   worse surprise than a wrong preview.
 *
 * Deliberately isomorphic and regex-based: `renderEmailHtml` runs in the browser and in Node, and
 * Node has no `DOMParser`. Pure string work gives both sides the same answer.
 */

/** A body only gets unwrapped when it carries one of the tags that only a document shell has. */
const DOCUMENT_SHELL = /<(?:!doctype\s+html|html|head|body)\b/i;

const BODY_CONTENT = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i;

/**
 * Strips a document shell down to the markup a layout can host.
 *
 * `<body>`'s contents win when there is one. Failing that (an exported fragment that opens `<html>`
 * and never closes `</body>`), the shell tags are removed individually and `<head>` goes with its
 * contents - a `<title>` or a `<meta>` rendered as body text is worse than dropping it.
 */
export function normalizeEmailBody(body: string): string {
  if (!DOCUMENT_SHELL.test(body)) return body;

  const inner = BODY_CONTENT.exec(body)?.[1] ?? body;
  return inner
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .trim();
}

export type EmailBodyWarningCode =
  | "document-shell"
  | "style-block"
  | "script-block"
  | "unbalanced-tag"
  | "class-attribute"
  | "relative-url"
  | "modern-layout";

export interface EmailBodyWarning {
  code: EmailBodyWarningCode;
  message: string;
}

/** Elements with no end tag, so an opening one must not be pushed onto the balance stack. */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Elements HTML lets you leave unclosed. `<p>one<p>two` and a `<td>` without `</td>` are both legal
 * and both common in hand-written email HTML, so neither may be reported as a mistake.
 */
const OPTIONAL_END_TAG = new Set([
  "caption",
  "colgroup",
  "dd",
  "dt",
  "li",
  "optgroup",
  "option",
  "p",
  "rp",
  "rt",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
]);

const TAG = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/)?>/g;

interface TagImbalance {
  tag: string;
  kind: "extra-close" | "unclosed";
}

/**
 * Finds the first tag that would break out of, or fail to close inside, the layout's content
 * wrapper.
 *
 * A stray `</div>` is the case worth catching: the parser matches it against the wrapper
 * `renderEmailHtml` opened, and the sign-off and footer end up outside the styled card. That is
 * exactly the kind of damage the preview shows without explaining.
 */
function findTagImbalance(html: string): TagImbalance | null {
  // Comments carry Outlook conditionals and must survive the render, but their contents are not
  // part of the balance. `<script>`/`<style>` bodies are raw text, so `<` inside them is not a tag.
  const scanned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");

  const stack: string[] = [];

  for (const match of scanned.matchAll(TAG)) {
    const isClosing = match[1] === "/";
    const name = match[2].toLowerCase();
    const isSelfClosing = match[3] === "/";

    if (VOID_ELEMENTS.has(name)) continue;

    if (!isClosing) {
      if (!isSelfClosing) stack.push(name);
      continue;
    }

    while (
      stack.length > 0 &&
      stack[stack.length - 1] !== name &&
      OPTIONAL_END_TAG.has(stack[stack.length - 1])
    ) {
      stack.pop();
    }

    if (stack.length === 0 || stack[stack.length - 1] !== name) {
      return { tag: name, kind: "extra-close" };
    }
    stack.pop();
  }

  const unclosed = stack.find((name) => !OPTIONAL_END_TAG.has(name));
  return unclosed ? { tag: unclosed, kind: "unclosed" } : null;
}

/**
 * `+` rather than `*` on the capture: an empty `href=""` clears the lookahead and would otherwise
 * be reported as `"" is a relative URL`, which names nothing an author can act on. Skipping the
 * position lets the scan carry on to a later attribute that really is relative.
 */
const RELATIVE_URL = /\b(?:href|src)\s*=\s*["'](?!(?:[a-z][a-z0-9+.-]*:|\/\/|#))([^"']+)["']/i;

/**
 * Describes everything about a body that the preview will render more kindly than a real inbox
 * will, plus the one thing that breaks the layout outright.
 *
 * Advisory only. The composer shows these next to the preview; nothing here blocks a send, because
 * an admin who knows their audience's client may well be right to ignore all of it.
 */
export function inspectEmailBody(body: string): EmailBodyWarning[] {
  const warnings: EmailBodyWarning[] = [];
  if (!body.trim()) return warnings;

  if (DOCUMENT_SHELL.test(body)) {
    warnings.push({
      code: "document-shell",
      message:
        "This looks like a complete HTML document. Only the contents of its <body> are sent - the layout supplies the rest.",
    });
  }

  if (/<style\b/i.test(body)) {
    warnings.push({
      code: "style-block",
      message:
        "Outlook and Gmail drop <style> blocks. These rules render here and will not render in an inbox - move them to inline style attributes.",
    });
  }

  if (/<script\b/i.test(body)) {
    warnings.push({
      code: "script-block",
      message: "Every email client strips <script>. The preview blocks it too.",
    });
  }

  const imbalance = findTagImbalance(normalizeEmailBody(body));
  if (imbalance) {
    warnings.push({
      code: "unbalanced-tag",
      message:
        imbalance.kind === "extra-close"
          ? `A </${imbalance.tag}> has nothing to close. It will close the layout's wrapper instead, pushing the sign-off and footer outside the card.`
          : `<${imbalance.tag}> is never closed, so everything the layout adds after the body ends up inside it.`,
    });
  }

  if (/\sclass\s*=\s*["'][^"']/i.test(body)) {
    warnings.push({
      code: "class-attribute",
      message:
        "class attributes have no stylesheet to match once the mail is delivered. Style with inline style attributes instead.",
    });
  }

  const relative = RELATIVE_URL.exec(body);
  if (relative) {
    warnings.push({
      code: "relative-url",
      message: `"${relative[1]}" is a relative URL and cannot resolve from an inbox. Use a full https:// address.`,
    });
  }

  if (/display\s*:\s*(?:flex|inline-flex|grid|inline-grid)/i.test(body)) {
    warnings.push({
      code: "modern-layout",
      message:
        "Outlook lays out neither flexbox nor grid. Use a table for anything that has to sit side by side.",
    });
  }

  return warnings;
}
