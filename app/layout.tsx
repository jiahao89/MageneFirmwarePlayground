import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "固件产品工作台 · Magene",
  description: "迈金室外固件产品团队的知识库与 AI 产品助手。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
