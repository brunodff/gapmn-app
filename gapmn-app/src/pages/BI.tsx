import React from "react";
import { Card } from "../components/Card";

export default function BI() {
  const url = import.meta.env.VITE_BI_URL as string;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-semibold">Painéis de BI</h2>
        <p className="text-sm text-slate-600">
          Abrindo dentro do gapmn.app (sem nova aba).
        </p>
      </Card>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <iframe
          title="BI"
          src={url}
          className="h-[75dvh] w-full"
          allow="fullscreen"
        />
      </div>
    </div>
  );
}
