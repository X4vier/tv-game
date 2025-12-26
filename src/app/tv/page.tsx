"use client";

import dynamic from "next/dynamic";

const TvGame = dynamic(() => import("~/snake/ui/TvGame").then((m) => m.TvGame), {
  ssr: false,
});

export default function TvPage() {
  return <TvGame />;
}
