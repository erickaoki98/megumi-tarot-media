import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PulsePost Admin",
  description: "Agendamento multirrede com biblioteca de midias e regras de repostagem.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="bg-hero-wash font-body text-ink">{children}</body>
    </html>
  );
}
