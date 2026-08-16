"use client";

/**
 * Last resort for a failure in the root layout itself, where the app shell (and its styles) never
 * mounted. It has to render its own `<html>`/`<body>`, and cannot rely on any app component.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>The admin dashboard failed to start</h1>
        <p style={{ color: "#666", maxWidth: "40rem", textAlign: "center" }}>
          {error.message || "An unexpected error occurred before the app could render."}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{ border: "1px solid #ccc", borderRadius: "0.375rem", padding: "0.5rem 1rem" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
