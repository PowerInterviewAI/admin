/**
 * A tokenizer for the HTML an author types into a campaign body.
 *
 * It returns tokens rather than markup on purpose. The composer paints them with `textContent`,
 * so the campaign body - raw author-written HTML, in the admin app's own document rather than the
 * sandboxed preview frame - has no path to becoming live markup. A highlighter that returned an
 * HTML string would put one escaping bug between a pasted `<img onerror=...>` and script execution
 * on a page that talks straight to the database.
 *
 * The one invariant everything else rests on: `tokenize(s).map(t => t.value).join("") === s`. Not a
 * character is added, dropped, or reordered, which is what lets the painted layer line up glyph for
 * glyph under a transparent textarea.
 *
 * Hand-written rather than a highlighter dependency because the language is fixed and small, and
 * because `style` attributes get their own treatment - an email body is almost entirely inline CSS,
 * so colouring every `style="..."` as one long string would highlight nothing worth seeing.
 */

export type TokenKind =
  | "text"
  | "tag-punct"
  | "tag-name"
  | "attr-name"
  | "attr-value"
  | "comment"
  | "meta"
  | "entity"
  | "css-prop"
  | "css-value"
  | "punct";

export interface Token {
  kind: TokenKind;
  value: string;
}

const ENTITY = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
const TAG_OPEN = /^<(\/?)([a-zA-Z][a-zA-Z0-9:._-]*)/;
const ATTRIBUTE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s"'=<>`]+)?/g;
const DECLARATION = /([^:;]*)(:)([^;]*)(;?)/g;
/** Splits a self-closing `/` off the end of an attribute run so it can be coloured as punctuation. */
const SELF_CLOSING = /^([\s\S]*?)(\/)(\s*)$/;

export function tokenizeHtml(source: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, value: string) => {
    if (value) tokens.push({ kind, value });
  };

  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("<", index);

    if (open === -1) {
      pushText(source.slice(index), push);
      break;
    }
    if (open > index) pushText(source.slice(index, open), push);

    // Comments first: Outlook conditionals live in them, and their contents are not markup.
    if (source.startsWith("<!--", open)) {
      const close = source.indexOf("-->", open + 4);
      const stop = close === -1 ? source.length : close + 3;
      push("comment", source.slice(open, stop));
      index = stop;
      continue;
    }

    // Doctype, CDATA, processing instructions.
    if (source.startsWith("<!", open) || source.startsWith("<?", open)) {
      const close = source.indexOf(">", open);
      const stop = close === -1 ? source.length : close + 1;
      push("meta", source.slice(open, stop));
      index = stop;
      continue;
    }

    const opening = TAG_OPEN.exec(source.slice(open));
    if (!opening) {
      // A bare `<` in prose. Emitting it as text keeps the join invariant and avoids colouring
      // half a sentence as a tag.
      push("text", "<");
      index = open + 1;
      continue;
    }

    // Scan to the tag's `>`, ignoring any that sits inside a quoted attribute value.
    let cursor = open + opening[0].length;
    let quote = "";
    while (cursor < source.length) {
      const character = source[cursor];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
      cursor += 1;
    }

    push("tag-punct", `<${opening[1]}`);
    push("tag-name", opening[2]);

    let attributes = source.slice(open + opening[0].length, cursor);
    const selfClosing = SELF_CLOSING.exec(attributes);
    if (selfClosing) attributes = selfClosing[1];

    pushAttributes(attributes, push);

    if (selfClosing) {
      push("tag-punct", selfClosing[2]);
      push("text", selfClosing[3]);
    }
    if (cursor < source.length) push("tag-punct", ">");

    index = cursor + 1;
  }

  return tokens;
}

function pushText(source: string, push: (kind: TokenKind, value: string) => void): void {
  let last = 0;
  for (const match of source.matchAll(ENTITY)) {
    if (match.index > last) push("text", source.slice(last, match.index));
    push("entity", match[0]);
    last = match.index + match[0].length;
  }
  push("text", source.slice(last));
}

function pushAttributes(source: string, push: (kind: TokenKind, value: string) => void): void {
  let last = 0;
  for (const match of source.matchAll(ATTRIBUTE)) {
    if (match.index > last) push("text", source.slice(last, match.index));

    const [whole, name, equals, value] = match;
    push("attr-name", name);
    if (equals) push("punct", equals);
    if (value !== undefined) {
      if (name.toLowerCase() === "style") pushStyleValue(value, push);
      else push("attr-value", value);
    }

    last = match.index + whole.length;
  }
  push("text", source.slice(last));
}

/**
 * Colours the declarations inside a `style` attribute.
 *
 * Worth the extra pass here specifically: the shared layout is table-based with everything inline,
 * so a campaign body is mostly CSS wearing an attribute's clothes.
 */
function pushStyleValue(raw: string, push: (kind: TokenKind, value: string) => void): void {
  const quote = raw[0];
  const isQuoted =
    (quote === '"' || quote === "'") && raw.length >= 2 && raw[raw.length - 1] === quote;
  const inner = isQuoted ? raw.slice(1, -1) : raw;

  if (isQuoted) push("attr-value", quote);

  let last = 0;
  for (const match of inner.matchAll(DECLARATION)) {
    if (match.index > last) push("css-value", inner.slice(last, match.index));
    push("css-prop", match[1]);
    push("punct", match[2]);
    push("css-value", match[3]);
    push("punct", match[4]);
    last = match.index + match[0].length;
  }
  push("css-value", inner.slice(last));

  if (isQuoted) push("attr-value", quote);
}
