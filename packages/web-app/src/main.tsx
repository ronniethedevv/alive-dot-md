import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import Landing from "./Landing.tsx";
import Catalog from "./Catalog.tsx";
import AgentDetail from "./AgentDetail.tsx";
import Jobs from "./Jobs.tsx";
import WalletScreen from "./WalletScreen.tsx";
import Docs from "./Docs.tsx";
import Hire from "./Hire.tsx";
import Job from "./Job.tsx";
import { WalletProvider } from "./components/Wallet.tsx";
import { RouteFocus, SkipLink } from "./components/RouteFocus.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <BrowserRouter>
        <SkipLink />
        <RouteFocus />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/agent/:agentId" element={<AgentDetail />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/wallet" element={<WalletScreen />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/hire/:agentId" element={<Hire />} />
        <Route path="/job/:jobId" element={<Job />} />
      </Routes>
    </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);
