import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * A production build writes into the same `.next` a running `pnpm dev` is serving from, which
   * leaves the dev server handing out a half-swapped manifest - the app dies with "Element type is
   * invalid" until dev is restarted. Setting `NEXT_DIST_DIR` sends a verification build somewhere
   * harmless instead of making the choice "check the build" or "keep the dev server".
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
