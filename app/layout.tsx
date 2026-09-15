import type { Metadata } from "next";
import "./globals.css";
import { WebMcpTools } from "@/components/webmcp-tools";

export const metadata: Metadata = {
  title: { default: "Quizloom — Live quizzes, bright minds", template: "%s · Quizloom" },
  description: "Run lively, real-time multiplayer quizzes for classrooms and college events.",
  icons: { icon: "/favicon.svg" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><WebMcpTools/>{children}</body></html>;
}
