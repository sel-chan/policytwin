import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": [
      "./artifacts/evidence/**/*",
      "./dist/**/*",
      "./fixtures/interpreter/seeded-refund-policy.txt",
      "./fixtures/interpreter/recorded-policy-ir.v1.json",
      "./fixtures/refund-demo/cases/golden-cases.json",
      "./fixtures/refund-demo/cases/seeded-drift-cases.json",
    ],
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
