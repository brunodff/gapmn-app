"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AppShell;
var react_1 = require("react");
var react_router_dom_1 = require("react-router-dom");
var supabase_1 = require("../lib/supabase");
var lucide_react_1 = require("lucide-react");
function AppShell(_a) {
    var children = _a.children, showChief = _a.showChief;
    var nav = (0, react_router_dom_1.useNavigate)();
    var loc = (0, react_router_dom_1.useLocation)();
    function handleLogout() {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, supabase_1.supabase.auth.signOut()];
                    case 1:
                        _a.sent();
                        nav("/login");
                        return [2 /*return*/];
                }
            });
        });
    }
    var isActive = function (path) {
        return loc.pathname === path ? "text-sky-700" : "text-slate-600";
    };
    return (<div className="min-h-dvh bg-gradient-to-b from-white to-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-sky-100"/>
            <div className="leading-tight">
              <div className="text-sm font-semibold">gapmn.app</div>
              <div className="text-xs text-slate-500">GAP-MN • ChatBI</div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <react_router_dom_1.Link className={"flex items-center gap-1 text-sm ".concat(isActive("/app"))} to="/app">
              <lucide_react_1.MessageCircle size={16}/> Chat
            </react_router_dom_1.Link>

            <react_router_dom_1.Link className={"flex items-center gap-1 text-sm ".concat(isActive("/bi"))} to="/bi" title="Abrir painéis de BI">
              <lucide_react_1.LayoutDashboard size={16}/> BI
            </react_router_dom_1.Link>

            {showChief && (<react_router_dom_1.Link className={"flex items-center gap-1 text-sm ".concat(isActive("/chief"))} to="/chief" title="Painel do Chefe do Grupamento">
                <lucide_react_1.Shield size={16}/> Chefe
              </react_router_dom_1.Link>)}

            <button onClick={handleLogout} className="ml-2 inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              <lucide_react_1.LogOut size={16}/>
              Sair
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>);
}
