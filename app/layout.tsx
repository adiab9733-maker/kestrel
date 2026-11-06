import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kestrel",
  description: "An autonomous agent that plans, researches, codes and delivers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <Logo />
            Kestrel
          </Link>
          <nav>
            <Link href="/">New task</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
