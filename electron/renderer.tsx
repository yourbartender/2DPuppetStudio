import React from "react";
import { createRoot } from "react-dom/client";
import { HandOscApp } from "../src/components/HandOscApp";
import "../src/styles.css";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            background: "#12161e",
            color: "#f87171",
            fontFamily: "monospace",
            minHeight: "100vh",
          }}
        >
          <h2 style={{ marginBottom: 8 }}>Puppet Studio Renderer Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", color: "#e5e7eb" }}>
            {this.state.error.stack || this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Electron renderer root element was not found.");
}

createRoot(container).render(
  <AppErrorBoundary>
    <HandOscApp />
  </AppErrorBoundary>,
);
