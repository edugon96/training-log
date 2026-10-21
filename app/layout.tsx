import type { Metadata, Viewport } from "next"
import { Golos_Text } from "next/font/google"
import "./globals.css"

const golos = Golos_Text({ subsets: ["latin"], variable: "--font-golos", display: "swap" })
export const metadata: Metadata = {
  title: "Training Log",
  description:
    "Your training plan, performance history, and every set in one place.",
  applicationName: "Training Log",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Training Log",
  },
  icons: { icon: "/training-icon.svg", apple: "/training-icon.svg" },
}
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101114",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${golos.variable} dark`}>
      <body>{children}</body>
    </html>
  )
}
