import { createFileRoute } from "@tanstack/react-router";
import { HandOscApp } from "@/components/HandOscApp";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "HandOSC — MediaPipe Hands to OSC for macOS" },
      {
        name: "description",
        content:
          "Desktop app translating Google MediaPipe hand tracking into OSC messages for Max/MSP, Ableton, TouchDesigner and more.",
      },
    ],
  }),
});

function Index() {
  return <HandOscApp />;
}
