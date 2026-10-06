import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { ToastHost } from "@/components/ToastHost";

export const metadata: Metadata = {
  title: "ArgusGov - DAO Circuit Breaker",
  description: "Institutional governance sentinel: catches proposals whose forum description does not match their calldata.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-canvas text-zinc-200 antialiased">
        <div className="ambient" aria-hidden />
        <Providers>
          {children}
          <ToastHost />
        </Providers>
      </body>
    </html>
  );
}
