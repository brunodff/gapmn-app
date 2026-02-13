import React from "react";

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-white p-4 shadow-sm">{children}</div>;
}
