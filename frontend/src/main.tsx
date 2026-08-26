import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Monta la app React en el div #root del index.html.
// StrictMode ayuda en desarrollo: detecta efectos duplicados y patrones riesgosos.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);