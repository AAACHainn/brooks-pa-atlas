import type { NextConfig } from "next";
import path from "node:path";

const projectRoot = path.resolve(__dirname);
const configuredTurbopackRoot = process.env.BROOKS_TURBOPACK_ROOT?.trim();
const turbopackRoot = configuredTurbopackRoot
  ? path.resolve(projectRoot, configuredTurbopackRoot)
  : projectRoot;

const configuredDevOrigins = (process.env.BROOKS_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedDevOrigins = Array.from(new Set(["*.*.*.*", ...configuredDevOrigins]));

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins,
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  turbopack: {
    // Avoid parent lockfiles making Turbopack treat a user or monorepo directory as this app's root.
    root: turbopackRoot,
  },
};

export default nextConfig;
