"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = BI;
var react_1 = require("react");
var Card_1 = require("../components/Card");
function BI() {
    var url = import.meta.env.VITE_BI_URL;
    return (<div className="space-y-4">
      <Card_1.Card>
        <h2 className="text-lg font-semibold">Painéis de BI</h2>
        <p className="text-sm text-slate-600">
          Abrindo dentro do gapmn.app (sem nova aba).
        </p>
      </Card_1.Card>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <iframe title="BI" src={url} className="h-[75dvh] w-full" allow="fullscreen"/>
      </div>
    </div>);
}
