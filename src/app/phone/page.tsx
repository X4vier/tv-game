"use client";

import dynamic from "next/dynamic";

const PhoneControls = dynamic(
  () => import("~/snake/ui/PhoneControls").then((m) => m.PhoneControls),
  { ssr: false }
);

export default function PhonePage() {
  return <PhoneControls />;
}
