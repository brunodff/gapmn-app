import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "../components/Card";

type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export default function AppChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id;
      if (!uid) return;

      const { data } = await supabase
        .from("chat_messages")
        .select("id, role, content, created_at")
        .order("id", { ascending: true });

      setMessages((data as any) ?? []);
    })();
  }, []);

  async function saveMessage(role: "user" | "assistant", content: string) {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) return;

    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ user_id: uid, role, content })
      .select("id, role, content, created_at")
      .single();

    if (error) throw error;
    setMessages((prev) => [...prev, data as any]);
  }

  async function getBotAnswer(question: string) {
    // MVP: tenta achar match simples na kb_entries (por texto)
    const q = question.trim().toLowerCase();

    const { data } = await supabase
      .from("kb_entries")
      .select("answer, question, intent")
      .limit(50);

    const entries = (data ?? []) as any[];
    const hit =
      entries.find((e) => (e.question as string).toLowerCase() === q) ||
      entries.find((e) => q.includes((e.intent as string).toLowerCase())) ||
      entries.find((e) => q.includes((e.question as string).toLowerCase().slice(0, 16)));

    if (hit?.answer) return hit.answer;

    return (
      "Ainda não tenho essa resposta cadastrada.\n\n" +
      "Dica: tente mencionar o nome do painel (ex.: Crédito Disponível, Movimentações, Contratos) e o que você quer ver.\n" +
      "Se quiser, descreva a dúvida com mais detalhe que eu vou registrar pra chefe incluir no app."
    );
  }

  async function handleSend() {
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    setLoading(true);

    try {
      await saveMessage("user", text);

      const answer = await getBotAnswer(text);
      await saveMessage("assistant", answer);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-lg font-semibold">Chatbot • GapMN</h2>
        <p className="text-sm text-slate-600">
          Me pergunta como achar informações nos painéis. Eu respondo com o passo a passo.
        </p>
      </Card>

      <Card>
        <div className="h-[55dvh] overflow-auto rounded-xl border bg-slate-50 p-3">
          {messages.length === 0 ? (
            <div className="text-sm text-slate-500">
              Comece perguntando algo tipo: “Como vejo o crédito disponível do GAP-MN?”
            </div>
          ) : (
            <div className="space-y-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "ml-auto bg-sky-600 text-white"
                      : "mr-auto bg-white border"
                  }`}
                >
                  <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite sua pergunta..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <button
            disabled={!canSend}
            onClick={handleSend}
            className="rounded-xl bg-sky-600 px-4 py-2 text-white hover:bg-sky-700 disabled:opacity-60"
          >
            Enviar
          </button>
        </div>
      </Card>
    </div>
  );
}
