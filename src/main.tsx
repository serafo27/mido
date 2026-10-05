import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/literata";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/fira-code";
import "katex/dist/katex.min.css";
import "./styles/app.css";
import "./styles/markdown.css";
import App from "./App";
import { migrateDefaults } from "./lib/settings";
import { isFloatingTerminal, isGitWindow } from "./lib/platform";

migrateDefaults();

// A floating window only loads what it shows.
const FloatingTerminal = React.lazy(() => import("./components/FloatingTerminal"));
const GitWindow = React.lazy(() => import("./components/GitWindow"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isFloatingTerminal || isGitWindow ? (
      <React.Suspense>{isFloatingTerminal ? <FloatingTerminal /> : <GitWindow />}</React.Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
