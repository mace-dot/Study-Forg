import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "StudyForge — Understand. Practice. Remember.",
  description:
    "Turn your course materials into a thorough review and an exam practice session.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
