import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";

type Ann = { id: number; title: string; body: string; created_at: string };
type KB = { id: number; intent: string; question: string; answer: string };

export default function ChiefPanel() {
  const [anns, setAnns] = useState<Ann[]>([]);
  const [kbs, setKbs] = useState<KB[]>([]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [intent, setIntent] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  async function reload() {
    const a = await supabase.from("announcements").select("id,title,body,created_at").order("id", { ascending: false });
    setAnns((a.data as any) ?? []);

    const k = await supabase.from("kb_entries").select("id,intent,question,answer").order("id", { ascending: false });
    setKbs((k.data as any) ?? []);
  }

  useEffect(() => {
    reload();
  }, []);

  async function createAnnouncement() {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;

    await supabase.from("announcements").insert({
      title: title.trim(),
      body: body.trim(),
      created_by: uid,
    });

    setTitle("");
    setBody("");
    reload();
  }

  async function createKB() {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;

    await supabase.from("kb_entries").insert({
      intent: intent.trim(),
      question: question.trim(),
      answer: answer.trim(),
      created_by: uid,
    });

    setIntent("");
    setQuestion("");
    setAnswer("");
    reload();
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-semibold">Painel do Chefe do Grupamento</h2>
        <p className="text-sm text-slate-600">
          Aqui você cadastra avisos e alimenta as respostas oficiais do chatbot.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="font-semibold">Novo aviso</h3>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título"
          />
          <textarea
            className="mt-2 w-full rounded-xl border px-3 py-2"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Texto do aviso"
            rows={4}
          />
          <button
            className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700"
            onClick={createAnnouncement}
            disabled={!title.trim() || !body.trim()}
          >
            Publicar aviso
          </button>

          <div className="mt-4 space-y-2">
            {anns.map((a) => (
              <div key={a.id} className="rounded-xl border bg-slate-50 p-3">
                <div className="text-sm font-semibold">{a.title}</div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{a.body}</div>
                <div className="mt-1 text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold">Base do Chatbot (KB)</h3>
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder='Intent (ex: "credito_disponivel")'
          />
          <input
            className="mt-2 w-full rounded-xl border px-3 py-2"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Pergunta (como o usuário escreve)"
          />
          <textarea
            className="mt-2 w-full rounded-xl border px-3 py-2"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Resposta passo-a-passo"
            rows={5}
          />
          <button
            className="mt-2 w-full rounded-xl bg-sky-600 px-3 py-2 text-white hover:bg-sky-700"
            onClick={createKB}
            disabled={!intent.trim() || !question.trim() || !answer.trim()}
          >
            Salvar resposta
          </button>

          <div className="mt-4 space-y-2">
            {kbs.map((k) => (
              <div key={k.id} className="rounded-xl border bg-white p-3">
                <div className="text-xs text-slate-500">intent: {k.intent}</div>
                <div className="text-sm font-semibold">{k.question}</div>
                <div className="text-sm text-slate-700 whitespace-pre-wrap">{k.answer}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
