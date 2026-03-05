import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DispatchIQ",
  description: "Optimization layer for developer email workflows"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
