import type { NextConfig } from "next";

const configuredDevOrigins = (process.env.BROOKS_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedDevOrigins = Array.from(new Set(["*.*.*.*", ...configuredDevOrigins]));

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
