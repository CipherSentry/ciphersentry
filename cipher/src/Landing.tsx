import { useEffect, useState } from "react";
import AccessModal from "./components/AccessModal";
import Frame from "./components/Frame";
import Header from "./components/Header";
import Hero from "./components/Hero";
import CtaBand from "./components/CtaBand";
import Footer from "./components/Footer";

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
      <main className="pt-[68px]">
        <Hero />
        <CtaBand />
        <Footer />
      </main>
    </div>
  );
}
