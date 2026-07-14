import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./artifacts/evidence/**/*", "./dist/**/*", "./fixtures/**/*"],
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
