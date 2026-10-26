import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hollow Alibi — a party game of terrible lies",
  description: "Make a claim, defend it over voice, and call your friends LIAR. Five rounds of ridiculous bluffs for 2–10 players, or solo with labeled bots.",
  metadataBase: new URL("https://hollow-alibi.smoky-harp-3438.chatgpt.site"),
  openGraph: {
    title: "Hollow Alibi",
    description: "Show a little truth. Sell a bigger lie. A party game for 2–10 players, or solo with bots.",
    images: ["/art/cover.png"],
  },
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
