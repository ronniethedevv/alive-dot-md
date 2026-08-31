import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import Landing from "./Landing.tsx";
import Catalog from "./Catalog.tsx";
import AgentDetail from "./AgentDetail.tsx";
import Docs from "./Docs.tsx";
import { WalletProvider } from "./components/Wallet.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/agent/:agentId" element={<AgentDetail />} />
        <Route path="/docs" element={<Docs />} />
      </Routes>
    </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);
