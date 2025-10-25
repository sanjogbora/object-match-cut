import './globals.css'
import { Inter } from 'next/font/google'
import { Analytics } from "@vercel/analytics/next"

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Object Match Cut Generator',
  description: 'AI-Powered Object Tracking Match Cut Video Generator - Create smooth object-aligned animations from your photos',
  keywords: ['match cut', 'video generator', 'object tracking', 'object alignment', 'animation', 'gif', 'mp4', 'SAM', 'computer vision'],
  authors: [{ name: 'Object Match Cut Generator' }],
  viewport: 'width=device-width, initial-scale=1',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      </head>
      <body className={inter.className}>
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
          {children}
        </div>
        <Analytics />
      </body>
    </html>
  )
}