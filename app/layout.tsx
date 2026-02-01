import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./components/sidebar";
import Walkthrough from "./components/walkthrough";

export const metadata: Metadata = {
  title: "Email Autopilot",
  description: "Data Mining 2 demo workspace for Resend-powered email autopilot"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="app-content">
            <Walkthrough />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
