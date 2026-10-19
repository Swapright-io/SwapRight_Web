import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwapRight",
  description: "A verified campus marketplace for useful goods.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
