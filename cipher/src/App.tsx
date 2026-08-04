import { useEffect, useState } from "react";
import DesktopApp from "./desktop/DesktopApp";
import OperatorApp from "./app/OperatorApp";
import DemoFlow from "./pages/DemoFlow";
import DocsPage from "./docs/DocsPage";
import Faq from "./pages/Faq";
import ExplorerPage from "./explorer/ExplorerPage";
import Cent from "./pages/Cent";
import Gates from "./pages/Gates";
import Investors from "./pages/Investors";
import Landing from "./Landing";
import Protocol from "./components/Protocol";

/** tiny hash router — #/ is the landing page, #/app is the console */
function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

export default function App() {
  const route = useRoute();
  const isApp = route.startsWith("/app");
  const isDocs = route.startsWith("/docs");
  const isExplorer = route.startsWith("/explorer");
  const isInvestors = route.startsWith("/investors");
  const isGates = route.startsWith("/gates");
  const isCent = route.startsWith("/cent") || route.startsWith("/orynth");
  const isFaq = route.startsWith("/faq");
  const isDemo = route.startsWith("/demo");
  const isProtocol = route.startsWith("/protocol");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [isApp, isDocs, isExplorer, isInvestors, isCent, route]);

  if (isExplorer) return <ExplorerPage />;
  if (isGates) return <Gates />;
  if (isCent) return <Cent />;
  if (isFaq) return <Faq />;
  if (isInvestors) return <Investors />;
  if (isDemo) return <DemoFlow />;
  if (isProtocol) return <Protocol />;
  if (isDocs) return <DocsPage slug={route.split("/")[2]} />;
  if (!isApp) return <Landing />;

  return (
    <>
      {/* desktop ops console — lg and up */}
      <div className="hidden h-svh lg:block">
        <DesktopApp />
      </div>
      {/* mobile operator app — below lg, full-bleed */}
      <div className="h-svh lg:hidden">
        <OperatorApp />
      </div>
      {/* way back to the site on mobile */}
      <a
        href="#/"
        aria-label="Back to ciphersentry.xyz"
        className="fixed bottom-[calc(var(--app-dock-h,4.75rem)+0.65rem)] right-3 z-[80] border border-edge bg-void/90 px-3 py-2 font-mono text-[8px] tracking-[0.22em] text-mute backdrop-blur-md transition-colors hover:border-volt/60 hover:text-volt active:bg-panel lg:hidden"
      >
        ← CIPHERSENTRY.XYZ
      </a>
    </>
  );
}
