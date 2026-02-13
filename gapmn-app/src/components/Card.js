"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Card = Card;
var react_1 = require("react");
function Card(_a) {
    var children = _a.children;
    return <div className="rounded-2xl border bg-white p-4 shadow-sm">{children}</div>;
}
