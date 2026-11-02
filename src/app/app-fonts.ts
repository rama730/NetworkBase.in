import localFont from "next/font/local";

export const instrumentSans = localFont({
  src: "./fonts/InstrumentSans.woff2",
  variable: "--font-instrument-sans",
  weight: "400 700",
  display: "swap",
});
export const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
  preload: false,
});
export const instrumentSerif = localFont({
  src: "./fonts/InstrumentSerif.woff2",
  variable: "--font-instrument-serif",
  weight: "400",
  display: "swap",
  preload: false,
});
