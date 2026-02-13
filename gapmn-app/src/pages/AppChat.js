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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AppChat;
var react_1 = require("react");
var supabase_1 = require("../lib/supabase");
var Card_1 = require("../components/Card");
function AppChat() {
    var _this = this;
    var _a = (0, react_1.useState)([]), messages = _a[0], setMessages = _a[1];
    var _b = (0, react_1.useState)(""), input = _b[0], setInput = _b[1];
    var _c = (0, react_1.useState)(false), loading = _c[0], setLoading = _c[1];
    var canSend = (0, react_1.useMemo)(function () { return input.trim().length > 0 && !loading; }, [input, loading]);
    (0, react_1.useEffect)(function () {
        (function () { return __awaiter(_this, void 0, void 0, function () {
            var sess, uid, data;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, supabase_1.supabase.auth.getSession()];
                    case 1:
                        sess = (_c.sent()).data;
                        uid = (_a = sess.session) === null || _a === void 0 ? void 0 : _a.user.id;
                        if (!uid)
                            return [2 /*return*/];
                        return [4 /*yield*/, supabase_1.supabase
                                .from("chat_messages")
                                .select("id, role, content, created_at")
                                .order("id", { ascending: true })];
                    case 2:
                        data = (_c.sent()).data;
                        setMessages((_b = data) !== null && _b !== void 0 ? _b : []);
                        return [2 /*return*/];
                }
            });
        }); })();
    }, []);
    function saveMessage(role, content) {
        return __awaiter(this, void 0, void 0, function () {
            var sess, uid, _a, data, error;
            var _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, supabase_1.supabase.auth.getSession()];
                    case 1:
                        sess = (_c.sent()).data;
                        uid = (_b = sess.session) === null || _b === void 0 ? void 0 : _b.user.id;
                        if (!uid)
                            return [2 /*return*/];
                        return [4 /*yield*/, supabase_1.supabase
                                .from("chat_messages")
                                .insert({ user_id: uid, role: role, content: content })
                                .select("id, role, content, created_at")
                                .single()];
                    case 2:
                        _a = _c.sent(), data = _a.data, error = _a.error;
                        if (error)
                            throw error;
                        setMessages(function (prev) { return __spreadArray(__spreadArray([], prev, true), [data], false); });
                        return [2 /*return*/];
                }
            });
        });
    }
    function getBotAnswer(question) {
        return __awaiter(this, void 0, void 0, function () {
            var q, data, entries, hit;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        q = question.trim().toLowerCase();
                        return [4 /*yield*/, supabase_1.supabase
                                .from("kb_entries")
                                .select("answer, question, intent")
                                .limit(50)];
                    case 1:
                        data = (_a.sent()).data;
                        entries = (data !== null && data !== void 0 ? data : []);
                        hit = entries.find(function (e) { return e.question.toLowerCase() === q; }) ||
                            entries.find(function (e) { return q.includes(e.intent.toLowerCase()); }) ||
                            entries.find(function (e) { return q.includes(e.question.toLowerCase().slice(0, 16)); });
                        if (hit === null || hit === void 0 ? void 0 : hit.answer)
                            return [2 /*return*/, hit.answer];
                        return [2 /*return*/, ("Ainda não tenho essa resposta cadastrada.\n\n" +
                                "Dica: tente mencionar o nome do painel (ex.: Crédito Disponível, Movimentações, Contratos) e o que você quer ver.\n" +
                                "Se quiser, descreva a dúvida com mais detalhe que eu vou registrar pra chefe incluir no app.")];
                }
            });
        });
    }
    function handleSend() {
        return __awaiter(this, void 0, void 0, function () {
            var text, answer;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!canSend)
                            return [2 /*return*/];
                        text = input.trim();
                        setInput("");
                        setLoading(true);
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, , 5, 6]);
                        return [4 /*yield*/, saveMessage("user", text)];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, getBotAnswer(text)];
                    case 3:
                        answer = _a.sent();
                        return [4 /*yield*/, saveMessage("assistant", answer)];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        setLoading(false);
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    }
    return (<div className="space-y-4">
      <Card_1.Card>
        <h2 className="text-lg font-semibold">Chatbot • GapMN</h2>
        <p className="text-sm text-slate-600">
          Me pergunta como achar informações nos painéis. Eu respondo com o passo a passo.
        </p>
      </Card_1.Card>

      <Card_1.Card>
        <div className="h-[55dvh] overflow-auto rounded-xl border bg-slate-50 p-3">
          {messages.length === 0 ? (<div className="text-sm text-slate-500">
              Comece perguntando algo tipo: “Como vejo o crédito disponível do GAP-MN?”
            </div>) : (<div className="space-y-2">
              {messages.map(function (m) { return (<div key={m.id} className={"max-w-[92%] rounded-2xl px-3 py-2 text-sm ".concat(m.role === "user"
                    ? "ml-auto bg-sky-600 text-white"
                    : "mr-auto bg-white border")}>
                  <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
                </div>); })}
            </div>)}
        </div>

        <div className="mt-3 flex gap-2">
          <input className="flex-1 rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200" value={input} onChange={function (e) { return setInput(e.target.value); }} placeholder="Digite sua pergunta..." onKeyDown={function (e) {
            if (e.key === "Enter")
                handleSend();
        }}/>
          <button disabled={!canSend} onClick={handleSend} className="rounded-xl bg-sky-600 px-4 py-2 text-white hover:bg-sky-700 disabled:opacity-60">
            Enviar
          </button>
        </div>
      </Card_1.Card>
    </div>);
}
