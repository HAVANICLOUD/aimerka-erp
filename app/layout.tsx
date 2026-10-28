import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIMERKA · Operación V28",
  description: "Pedidos, inventario, compras, gastos y conciliación en un mismo espacio.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-MX">
      <body className="antialiased">{children}</body>
    </html>
  );
}
