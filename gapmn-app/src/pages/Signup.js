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
exports.default = Signup;
var react_1 = require("react");
var react_router_dom_1 = require("react-router-dom");
var supabase_1 = require("../lib/supabase");
var validators_1 = require("../lib/validators");
var Card_1 = require("../components/Card");
var UNIDADES = [
    "CINDACTA IV",
    "GAP-MN",
    "SEREP-MN",
    "SERIPA-MN",
    "COMARA",
    "COMAR VII",
    "HAMN",
    "PAMN",
    "BAMN",
    "Outro",
];
var AVATARS = ["a1", "a2", "a3", "a4", "a5", "a6"];
function Signup() {
    var nav = (0, react_router_dom_1.useNavigate)();
    var _a = (0, react_1.useState)(""), email = _a[0], setEmail = _a[1];
    var _b = (0, react_1.useState)(""), senha = _b[0], setSenha = _b[1];
    var _c = (0, react_1.useState)(""), nomeGuerra = _c[0], setNomeGuerra = _c[1];
    var _d = (0, react_1.useState)("GAP-MN"), unidade = _d[0], setUnidade = _d[1];
    var _e = (0, react_1.useState)(""), unidadeOutro = _e[0], setUnidadeOutro = _e[1];
    var _f = (0, react_1.useState)("a1"), avatarKey = _f[0], setAvatarKey = _f[1];
    var _g = (0, react_1.useState)(false), loading = _g[0], setLoading = _g[1];
    var _h = (0, react_1.useState)(null), err = _h[0], setErr = _h[1];
    var unidadeFinal = (0, react_1.useMemo)(function () {
        if (unidade !== "Outro")
            return unidade;
        return unidadeOutro.trim() ? "Outro: ".concat(unidadeOutro.trim()) : "Outro";
    }, [unidade, unidadeOutro]);
    function handleSignup(e) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, data, error, user, pErr, e_1;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        e.preventDefault();
                        setErr(null);
                        if (!(0, validators_1.isFabEmail)(email)) {
                            setErr("Use um e-mail institucional @fab.mil.br.");
                            return [2 /*return*/];
                        }
                        if (senha.length < 8) {
                            setErr("A senha deve ter pelo menos 8 caracteres.");
                            return [2 /*return*/];
                        }
                        if (!nomeGuerra.trim()) {
                            setErr("Informe seu nome de guerra.");
                            return [2 /*return*/];
                        }
                        setLoading(true);
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 4, 5, 6]);
                        return [4 /*yield*/, supabase_1.supabase.auth.signUp({
                                email: email.trim().toLowerCase(),
                                password: senha,
                            })];
                    case 2:
                        _a = _c.sent(), data = _a.data, error = _a.error;
                        if (error)
                            throw error;
                        user = data.user;
                        if (!user) {
                            setErr("Conta criada. Verifique seu e-mail para confirmar e depois faça login.");
                            nav("/login");
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, supabase_1.supabase.from("profiles").insert({
                                id: user.id,
                                email: user.email,
                                nome_guerra: nomeGuerra.trim(),
                                unidade: unidadeFinal,
                                avatar_key: avatarKey,
                                role: "user",
                            })];
                    case 3:
                        pErr = (_c.sent()).error;
                        if (pErr)
                            throw pErr;
                        nav("/login");
                        return [3 /*break*/, 6];
                    case 4:
                        e_1 = _c.sent();
                        setErr((_b = e_1 === null || e_1 === void 0 ? void 0 : e_1.message) !== null && _b !== void 0 ? _b : "Erro ao criar conta.");
                        return [3 /*break*/, 6];
                    case 5:
                        setLoading(false);
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    }
    return (<div className="mx-auto max-w-md">
      <Card_1.Card>
        <h1 className="text-xl font-semibold">Criar conta</h1>
        <p className="mt-1 text-sm text-slate-600">
          Acesso com e-mail institucional. Interface clean, rápida e feita pro celular também.
        </p>

        <form onSubmit={handleSignup} className="mt-4 space-y-3">
          <div>
            <label className="text-sm text-slate-700">E-mail FAB</label>
            <input className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={email} onChange={function (e) { return setEmail(e.target.value); }} placeholder="seu.nome@fab.mil.br" type="email" autoComplete="email"/>
          </div>

          <div>
            <label className="text-sm text-slate-700">Senha</label>
            <input className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={senha} onChange={function (e) { return setSenha(e.target.value); }} placeholder="mínimo 8 caracteres" type="password" autoComplete="new-password"/>
          </div>

          <div>
            <label className="text-sm text-slate-700">Nome de guerra</label>
            <input className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={nomeGuerra} onChange={function (e) { return setNomeGuerra(e.target.value); }} placeholder="Ex: BRUNO"/>
          </div>

          <div>
            <label className="text-sm text-slate-700">Unidade</label>
            <select className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={unidade} onChange={function (e) { return setUnidade(e.target.value); }}>
              {UNIDADES.map(function (u) { return (<option key={u} value={u}>
                  {u}
                </option>); })}
            </select>

            {unidade === "Outro" && (<input className="mt-2 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={unidadeOutro} onChange={function (e) { return setUnidadeOutro(e.target.value); }} placeholder="Digite a unidade"/>)}
          </div>

          <div>
            <label className="text-sm text-slate-700">Avatar</label>
            <div className="mt-2 grid grid-cols-6 gap-2">
              {AVATARS.map(function (a) { return (<button key={a} type="button" onClick={function () { return setAvatarKey(a); }} className={"h-10 rounded-xl border ".concat(avatarKey === a ? "border-sky-400 ring-2 ring-sky-200" : "border-slate-200", " bg-sky-50")} title={"Avatar ".concat(a)}/>); })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Depois a gente troca por imagens reais geradas aqui na IA.
            </p>
          </div>

          {err && <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}

          <button disabled={loading} className="w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700 disabled:opacity-60">
            {loading ? "Criando..." : "Criar conta"}
          </button>

          <p className="text-center text-sm text-slate-600">
            Já tem conta? <react_router_dom_1.Link className="text-sky-700" to="/login">Entrar</react_router_dom_1.Link>
          </p>
        </form>
      </Card_1.Card>
    </div>);
}
