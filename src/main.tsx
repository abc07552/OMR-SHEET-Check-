import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query";
import "@fontsource-variable/dm-sans";
import App from "./App";
import { SessionProvider } from "./session";
import { initializeTheme } from "./theme";
import PWAStatus from "./PWAStatus";
import "./tailwind.css";
import "./styles.css";
import "./dark.css";
import "./enterprise.css";
import "./accounts.css";

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <SessionProvider>
          <App />
          <PWAStatus />
        </SessionProvider>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
