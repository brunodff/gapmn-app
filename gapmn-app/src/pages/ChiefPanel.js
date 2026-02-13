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
exports.default = ChiefPanel;
var react_1 = require("react");
var supabase_1 = require("../lib/supabase");
var Card_1 = require("../components/Card");
function ChiefPanel() {
    var _a = (0, react_1.useState)([]), anns = _a[0], setAnns = _a[1];
    var _b = (0, react_1.useState)([]), kbs = _b[0], setKbs = _b[1];
    var _c = (0, react_1.useState)(""), title = _c[0], setTitle = _c[1];
    var _d = (0, react_1.useState)(""), body = _d[0], setBody = _d[1];
    var _e = (0, react_1.useState)(""), intent = _e[0], setIntent = _e[1];
    var _f = (0, react_1.useState)(""), question = _f[0], setQuestion = _f[1];
    var _g = (0, react_1.useState)(""), answer = _g[0], setAnswer = _g[1];
    function reload() {
        return __awaiter(this, void 0, void 0, function () {
            var a, k;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0: return [4 /*yield*/, supabase_1.supabase.from("announcements").select("id,title,body,created_at").order("id", { ascending: false })];
                    case 1:
                        a = _c.sent();
                        setAnns((_a = a.data) !== null && _a !== void 0 ? _a : []);
                        return [4 /*yield*/, supabase_1.supabase.from("kb_entries").select("id,intent,question,answer").order("id", { ascending: false })];
                    case 2:
                        k = _c.sent();
                        setKbs((_b = k.data) !== null && _b !== void 0 ? _b : []);
                        return [2 /*return*/];
                }
            });
        });
    }
    (0, react_1.useEffect)(function () {
        reload();
    }, []);
    function createAnnouncement() {
        return __awaiter(this, void 0, void 0, function () {
            var sess, uid;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, supabase_1.supabase.auth.getSession()];
                    case 1:
                        sess = (_b.sent()).data;
                        uid = (_a = sess.session) === null || _a === void 0 ? void 0 : _a.user.id;
                        if (!uid)
                            return [2 /*return*/];
                        return [4 /*yield*/, supabase_1.supabase.from("announcements").insert({
                                title: title.trim(),
                                body: body.trim(),
                                created_by: uid,
                            })];
                    case 2:
                        _b.sent();
                        setTitle("");
                        setBody("");
                        reload();
                        return [2 /*return*/];
                }
            });
        });
    }
    function createKB() {
        return __awaiter(this, void 0, void 0, function () {
            var sess, uid;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, supabase_1.supabase.auth.getSession()];
                    case 1:
                        sess = (_b.sent()).data;
                        uid = (_a = sess.session) === null || _a === void 0 ? void 0 : _a.user.id;
                        if (!uid)
                            return [2 /*return*/];
                        return [4 /*yield*/, supabase_1.supabase.from("kb_entries").insert({
                                intent: intent.trim(),
                                question: question.trim(),
                                answer: answer.trim(),
                                created_by: uid,
                            })];
                    case 2:
                        _b.sent();
                        setIntent("");
                        setQuestion("");
                        setAnswer("");
                        reload();
                        return [2 /*return*/];
                }
            });
        });
    }
    return (<div className="space-y-4">
      <Card_1.Card>
        <h2 className="text-lg font-semibold">Painel do Chefe do Grupamento</h2>
        <p className="text-sm text-slate-600">
          Aqui você cadastra avisos e alimenta as respostas oficiais do chatbot.
        </p>
      </Card_1.Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card_1.Card>
          <h3 className="font-semibold">Novo aviso</h3>
          <input className="mt-2 w-full rounded-xl border px-3 py-2" value={title} onChange={function (e) { return setTitle(e.target.value); }} placeholder="Título"/>
          <textarea className="mt-2 w-full rounded-xl border px-3 py-2" value={body} onChange={function (e) { return setBody(e.target.value); }} placeholder="Texto do aviso" rows={4}/>
          <button className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700" onClick={createAnnouncement} disabled={!title.trim() || !body.trim()}>
            Publicar aviso
          </button>

          <div className="mt-4 space-y-2">
            {anns.map(function (a) { return (<div key={a.id} className="rounded-xl border bg-slate-50 p-3">
                <div className="text-sm font-semibold">{a.title}</div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{a.body}</div>
                <div className="mt-1 text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</div>
              </div>); })}
          </div>
        </Card_1.Card>

        <Card_1.Card>
          <h3 className="font-semibold">Base do Chatbot (KB)</h3>
          <input className="mt-2 w-full rounded-xl border px-3 py-2" value={intent} onChange={function (e) { return setIntent(e.target.value); }} placeholder='Intent (ex: "credito_disponivel")'/>
          <input className="mt-2 w-full rounded-xl border px-3 py-2" value={question} onChange={function (e) { return setQuestion(e.target.value); }} placeholder="Pergunta (como o usuário escreve)"/>
          <textarea className="mt-2 w-full rounded-xl border px-3 py-2" value={answer} onChange={function (e) { return setAnswer(e.target.value); }} placeholder="Resposta passo-a-passo" rows={5}/>
          <button className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700" onClick={createKB} disabled={!intent.trim() || !question.trim() || !answer.trim()}>
            Salvar resposta
          </button>

          <div className="mt-4 space-y-2">
            {kbs.map(function (k) { return (<div key={k.id} className="rounded-xl border bg-white p-3">
                <div className="text-xs text-slate-500">intent: {k.intent}</div>
                <div className="text-sm font-semibold">{k.question}</div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{k.answer}</div>
              </div>); })}
          </div>
        </Card_1.Card>
      </div>
    </div>);
}
