import { createRoot } from "react-dom/client";
import { HandOscApp } from "../src/components/HandOscApp";
import "../src/styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Electron renderer root element was not found.");
}

createRoot(container).render(<HandOscApp />);