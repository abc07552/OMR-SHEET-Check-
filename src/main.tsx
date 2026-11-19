import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/dm-sans";
import App from "./App";
import { SessionProvider } from "./session";
import "./styles.css";
import "./dark.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </React.StrictMode>,
);
