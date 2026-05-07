import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.BROOKS_ALLOWED_DEV_ORIGINS ?? "192.168.1.8")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins,
};

export default nextConfig;
