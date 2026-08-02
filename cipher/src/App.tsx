import { useEffect, useState } from "react";
import AsciiMotion from "./components/AsciiMotion";
import DesktopApp from "./desktop/DesktopApp";
import OperatorApp from "./app/OperatorApp";
import DemoFlow from "./pages/DemoFlow";
import DocsPage from "./docs/DocsPage";
import Faq from "./pages/Faq";
import ExplorerPage from "./explorer/ExplorerPage";
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
  const isFaq = route.startsWith("/faq");
  const isDemo = route.startsWith("/demo");
  const isProtocol = route.startsWith("/protocol");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [isApp, isDocs, isExplorer, isInvestors, route]);

  let page: React.ReactNode;
  if (isExplorer) page = <ExplorerPage />;
  else if (isGates) page = <Gates />;
  else if (isFaq) page = <Faq />;
  else if (isInvestors) page = <Investors />;
  else if (isDemo) page = <DemoFlow />;
  else if (isProtocol) page = <Protocol />;
  else if (isDocs) page = <DocsPage slug={route.split("/")[2]} />;
  else if (!isApp) page = <Landing />;
  else
    page = (
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
          className="fixed bottom-[max(6.5rem,env(safe-area-inset-bottom,0px)+5.5rem)] right-3 z-[80] border border-edge bg-void/85 px-3 py-2 font-mono text-[8px] tracking-[0.22em] text-mute backdrop-blur transition-colors hover:border-volt/60 hover:text-volt lg:hidden"
        >
          ← CIPHERSENTRY.XYZ
        </a>
      </>
    );

  return (
    <>
      {/* ambient ASCII field — every route; denser (quieter rails) inside the app */}
      <AsciiMotion dense={isApp} />
      {page}
    </>
  );
}
