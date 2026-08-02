import { useEffect, useState } from "react";
import AccessModal from "./components/AccessModal";
import AsciiShowcase from "./components/AsciiShowcase";
import CtaBand from "./components/CtaBand";
import Footer from "./components/Footer";
import Frame from "./components/Frame";
import Header from "./components/Header";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import Roadmap from "./components/Roadmap";
import Ticker from "./components/Ticker";

export default function Landing() {
  const [accessOpen, setAccessOpen] = useState(false);

  useEffect(() => {
    const open = () => setAccessOpen(true);
    window.addEventListener("cent:request-access", open);
    return () => window.removeEventListener("cent:request-access", open);
  }, []);

  return (
    <div className="relative isolate min-h-screen overflow-x-clip bg-void font-display text-mist">
      <AccessModal open={accessOpen} onClose={() => setAccessOpen(false)} />
      <Frame />
      <Header />
      <main className="pt-[calc(60px+env(safe-area-inset-top,0px))] sm:pt-[calc(68px+env(safe-area-inset-top,0px))]">
        <Hero />
        <Ticker />
        <HowItWorks />
        <AsciiShowcase />
        <Roadmap />
        <CtaBand />
        <Footer />
      </main>
    </div>
  );
}
