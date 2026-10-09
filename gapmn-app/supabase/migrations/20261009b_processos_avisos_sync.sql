-- Avisos de processo: a primeira leitura dos itens (sync-processos) só troca a situação
-- provisória ("Publicado"/"Homologado", calculada antes de ter os itens) pela calculada
-- pelos itens — não é novidade. Só avisa mudança em processo que já tinha itens lidos
-- (itens_sync_em preenchido antes). Marcação manual continua avisando sempre.
create or replace function public.fn_notify_processo_change()
returns trigger language plpgsql security definer as $function$
declare
  msgs      text[] := array[]::text[];
  msg_final text;
  ja_lido   boolean := old.itens_sync_em is not null;
begin
  if ja_lido and old.situacao is not null and old.situacao is distinct from new.situacao then
    msgs := array_append(msgs,
      '🔄 Situação alterada de "' || old.situacao || '" para "' || coalesce(new.situacao, '(removida)') || '"');
  end if;

  if ja_lido and old.valor_homologado is distinct from new.valor_homologado then
    msgs := array_append(msgs,
      '✅ Valor Homologado: ' || coalesce(to_char(old.valor_homologado, 'FM"R$"999G999G990D00'), '(sem valor)') ||
      ' → ' || coalesce(to_char(new.valor_homologado, 'FM"R$"999G999G990D00'), '(removido)'));
  end if;

  if old.homologado_manual is distinct from new.homologado_manual then
    msgs := array_append(msgs,
      case when new.homologado_manual then '✅ Marcado como homologado manualmente'
           else '↩️ Homologação manual removida' end);
  end if;

  if array_length(msgs, 1) is null then return new; end if;

  msg_final := '⚖️ Processo ' || coalesce(new.modalidade || ' ', '') || coalesce(new.numero_processo, '') || e'\n' ||
               array_to_string(msgs, e'\n');

  insert into feed_items (titulo, tipo, link_tab)
  values (msg_final, 'processos', 'processos');

  insert into user_notifications (user_id, tipo, ref_id, ref_label, mensagem)
  select ua.user_id, 'processo', ua.ref_id, ua.ref_label, msg_final
  from user_acompanhamentos ua
  where ua.tipo = 'processo' and ua.ref_id = new.id::text;

  return new;
end;
$function$;

-- Processo novo: junta só a um aviso "Novos processos publicados" recente (antes juntava
-- a qualquer aviso de processo dos últimos 2 minutos, misturando com mudanças de situação)
create or replace function public.fn_notify_processo_insert_dedup()
returns trigger language plpgsql security definer as $function$
declare
  existing_id uuid;
  new_detail  text;
begin
  -- Processo antigo trazido pela sincronização (carga inicial): não é novidade
  if new.data_publicacao is not null and new.data_publicacao < current_date - 60 then
    return new;
  end if;

  new_detail := coalesce(new.modalidade, '') || ' ' || coalesce(new.numero_processo, '') ||
                coalesce(' — ' || left(new.objeto, 90), '');

  select id into existing_id
  from feed_items
  where tipo = 'processos' and titulo like '⚖️ Novos processos publicados%'
    and created_at > now() - interval '2 minutes'
  order by created_at desc
  limit 1;

  if existing_id is not null then
    update feed_items set titulo = titulo || e'\n• ' || new_detail where id = existing_id;
  else
    insert into feed_items (titulo, tipo, link_tab)
    values ('⚖️ Novos processos publicados:' || e'\n• ' || new_detail, 'processos', 'processos');
  end if;
  return new;
end;
$function$;
