import type { Metadata } from "next";
import "./globals.css";
import "./overrides.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "PolicyTwin — Executable policy proof", template: "%s · PolicyTwin" },
  description: "Turn a refund policy sentence into traceable rules, tests, application behavior, and proof.",
  openGraph: {
    type: "website",
    title: "PolicyTwin — Executable policy proof",
    description: "Turn policy text into verified product behavior.",
    images: [{ url: "/og.png", width: 1716, height: 920, alt: "PolicyTwin evidence pipeline" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "PolicyTwin — Executable policy proof",
    description: "Turn policy text into verified product behavior.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
