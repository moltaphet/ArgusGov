import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "ArgusGov - DAO Circuit Breaker",
  description: "Live governance sentinel: catches proposals whose forum description does not match their calldata.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="backdrop" aria-hidden />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
