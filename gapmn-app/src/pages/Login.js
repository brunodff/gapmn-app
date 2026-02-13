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
exports.default = Login;
var react_1 = require("react");
var react_router_dom_1 = require("react-router-dom");
var supabase_1 = require("../lib/supabase");
var Card_1 = require("../components/Card");
function Login() {
    var _a;
    var nav = (0, react_router_dom_1.useNavigate)();
    var loc = (0, react_router_dom_1.useLocation)();
    var redirectTo = ((_a = loc.state) === null || _a === void 0 ? void 0 : _a.from) || "/app";
    var _b = (0, react_1.useState)(""), email = _b[0], setEmail = _b[1];
    var _c = (0, react_1.useState)(""), senha = _c[0], setSenha = _c[1];
    var _d = (0, react_1.useState)(false), loading = _d[0], setLoading = _d[1];
    var _e = (0, react_1.useState)(null), err = _e[0], setErr = _e[1];
    function handleLogin(e) {
        return __awaiter(this, void 0, void 0, function () {
            var error, e_1;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        e.preventDefault();
                        setErr(null);
                        setLoading(true);
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, 4, 5]);
                        return [4 /*yield*/, supabase_1.supabase.auth.signInWithPassword({
                                email: email.trim().toLowerCase(),
                                password: senha,
                            })];
                    case 2:
                        error = (_b.sent()).error;
                        if (error)
                            throw error;
                        nav(redirectTo);
                        return [3 /*break*/, 5];
                    case 3:
                        e_1 = _b.sent();
                        setErr((_a = e_1 === null || e_1 === void 0 ? void 0 : e_1.message) !== null && _a !== void 0 ? _a : "Erro ao entrar.");
                        return [3 /*break*/, 5];
                    case 4:
                        setLoading(false);
                        return [7 /*endfinally*/];
                    case 5: return [2 /*return*/];
                }
            });
        });
    }
    return (<div className="mx-auto max-w-md">
      <Card_1.Card>
        <h1 className="text-xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-slate-600">Use suas credenciais para acessar o chat.</p>

        <form onSubmit={handleLogin} className="mt-4 space-y-3">
          <div>
            <label className="text-sm text-slate-700">E-mail</label>
            <input className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={email} onChange={function (e) { return setEmail(e.target.value); }} type="email" autoComplete="email"/>
          </div>

          <div>
            <label className="text-sm text-slate-700">Senha</label>
            <input className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={senha} onChange={function (e) { return setSenha(e.target.value); }} type="password" autoComplete="current-password"/>
          </div>

          {err && <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}

          <button disabled={loading} className="w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-60">
            {loading ? "Entrando..." : "Entrar"}
          </button>

          <p className="text-center text-sm text-slate-600">
            Não tem conta? <react_router_dom_1.Link className="text-sky-700" to="/signup">Criar</react_router_dom_1.Link>
          </p>
        </form>
      </Card_1.Card>
    </div>);
}
