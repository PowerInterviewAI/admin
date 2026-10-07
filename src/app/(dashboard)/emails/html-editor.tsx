"use client";

import { useEffect, useImperativeHandle, useRef } from "react";

import { tokenizeHtml } from "@/lib/email/highlight";
import { cn } from "@/lib/utils";

export interface HtmlEditorHandle {
  /**
   * Repaints the highlight layer from the textarea's current value.
   *
   * Needed after a programmatic write. `setValue` updates the element without firing `input`, so
   * the layer would otherwise keep showing the body that was just replaced - the same reason the
   * composer has to tell the preview about the starter layout separately.
   */
  sync: () => void;
}

/**
 * Every metric that decides where a glyph lands has to be identical on both layers, or the
 * highlight drifts out from under the text as soon as a line wraps. Kept in one string so the two
 * cannot be edited apart.
 *
 * `scrollbar-gutter: stable` is the load-bearing one. The textarea's scrollbar eats into the width
 * its text wraps at, and the layer never scrolls, so without a gutter reserved on both the two wrap
 * at different columns the moment the body outgrows the box. Reserving it in CSS keeps the content
 * width constant, which is what lets the layer be positioned once instead of re-measured on every
 * keystroke.
 */
const TEXT_METRICS =
  "px-2.5 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words [tab-size:2] [scrollbar-gutter:stable]";

interface HtmlEditorProps extends Omit<React.ComponentProps<"textarea">, "ref"> {
  ref?: React.Ref<HtmlEditorHandle>;
  /** The textarea element itself. This is where `register("body")`'s ref goes. */
  inputRef?: React.Ref<HTMLTextAreaElement>;
  invalid?: boolean;
}

/**
 * A syntax-highlighted HTML editor built as a transparent textarea over a painted layer.
 *
 * The textarea stays a real, uncontrolled textarea: native undo, spellcheck control, RHF's
 * `register` ref, and the browser's own caret and selection all keep working, which is most of
 * what an editor library would have replaced with its own approximations.
 *
 * Painting is imperative and driven by a native `input` listener rather than React state. That is
 * load-bearing for this page: the composer feeds the preview imperatively precisely so a keystroke
 * costs no React render, and highlighting through state would have put a full re-render of the
 * form back on every keypress. It also means the paint cannot be skipped by whatever the consumer
 * does with `onChange`.
 */
export function HtmlEditor({
  ref,
  inputRef,
  invalid,
  className,
  onScroll,
  ...props
}: HtmlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLPreElement>(null);

  useImperativeHandle(ref, () => ({ sync: () => paint(layerRef.current, textareaRef.current) }), []);

  useEffect(() => {
    const textarea = textareaRef.current;
    const layer = layerRef.current;
    if (!textarea || !layer) return;

    const repaint = () => paint(layer, textarea);
    const follow = () => {
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    };

    repaint();
    textarea.addEventListener("input", repaint);
    textarea.addEventListener("scroll", follow);
    return () => {
      textarea.removeEventListener("input", repaint);
      textarea.removeEventListener("scroll", follow);
    };
  }, []);

  return (
    <div
      data-invalid={invalid || undefined}
      className={cn(
        // Scoped rather than set on <html>: it is only needed because this field now always shows
        // a scrollbar gutter, and a light track on the dark theme is the one place it shows.
        "scheme-light dark:scheme-dark",
        "relative rounded-lg border border-input transition-colors",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50",
        "data-invalid:border-destructive data-invalid:ring-2 data-invalid:ring-destructive/20",
        "dark:bg-input/30 dark:data-invalid:border-destructive/50",
        className,
      )}
    >
      <pre
        ref={layerRef}
        aria-hidden
        className={cn(
          TEXT_METRICS,
          "pointer-events-none absolute inset-0 m-0 overflow-hidden text-foreground",
        )}
      />
      <textarea
        ref={mergeRefs(textareaRef, inputRef)}
        spellCheck={false}
        // `field-sizing-fixed` is not cosmetic: the base textarea is `field-sizing-content`, which
        // re-measures the whole body on every keystroke and grows the page unbounded.
        className={cn(
          TEXT_METRICS,
          "relative block field-sizing-fixed w-full resize-y overflow-auto rounded-lg bg-transparent",
          "text-transparent caret-foreground outline-none",
          // The selection rectangle is painted in this layer, above the colours. Without alpha it
          // would blank out whatever is selected.
          "selection:bg-primary/30",
          "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        )}
        onScroll={(event) => {
          const layer = layerRef.current;
          if (layer) {
            layer.scrollTop = event.currentTarget.scrollTop;
            layer.scrollLeft = event.currentTarget.scrollLeft;
          }
          onScroll?.(event);
        }}
        {...props}
      />
    </div>
  );
}

/**
 * Past this, painting costs more than a frame and typing goes sticky. A body this size is a
 * template pasted with its images inlined, not something anyone is editing character by character,
 * so it falls back to plain text rather than trading the editor's responsiveness for colour.
 */
const HIGHLIGHT_LIMIT = 40_000;

function paint(layer: HTMLPreElement | null, textarea: HTMLTextAreaElement | null): void {
  if (!layer || !textarea) return;

  const source = textarea.value;
  if (source.length > HIGHLIGHT_LIMIT) {
    // Set inline so it beats the `text-transparent` class without React owning the toggle.
    textarea.style.color = "var(--foreground)";
    layer.replaceChildren();
    return;
  }
  textarea.style.color = "";

  const fragment = document.createDocumentFragment();
  for (const token of tokenizeHtml(source)) {
    if (token.kind === "text") {
      fragment.appendChild(document.createTextNode(token.value));
      continue;
    }
    const span = document.createElement("span");
    span.className = `tok-${token.kind}`;
    // `textContent`, never `innerHTML`: the value here is author-written HTML, and this layer
    // lives in the admin document rather than the sandboxed preview frame.
    span.textContent = token.value;
    fragment.appendChild(span);
  }

  // A textarea always reserves a line for the caret after the last character; a `pre` only lays
  // out a line box if something is on it. Without this the layer is one line shorter, and scrolled
  // to the bottom the two run out of step. A zero-width space adds the line box and no glyph -
  // a newline would not, since it is the trailing break that gets no box of its own.
  fragment.appendChild(document.createTextNode("​"));
  layer.replaceChildren(fragment);
}

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref) (ref as React.RefObject<T | null>).current = value;
    }
  };
}
