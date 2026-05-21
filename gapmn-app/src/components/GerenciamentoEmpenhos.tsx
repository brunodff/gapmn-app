import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { Card } from "./Card";
import { fetchCSV, toEmpenhosNF, SHEET_URLS, EmpenhoNF } from "../lib/gsheets";

// ─── Mapeamento de código UG → nome ──────────────────────────────────────────
const UG_CODE_MAP: Record<string, string> = {
  "120630": "GAP-MN",
  "120094": "DACTA IV",
  "120082": "BAMN",
  "120154": "HAMN",
  "788701": "HAMN",
  "120519": "PAMN",
  "120254": "SEREP-MN",
  "120083": "COMAR VII",
  "120174": "SERIPA-MN",
  "120036": "DECEA",
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface NeIdent {
  ne_siafi:      string;
  identificador: string;
  solicitacao:   string | null;
  subprocesso?:  string | null;
  perfil_atual?: string | null;
}

interface SeSolicitacao {
  solicitacao:             string;
  ug_cred:                 string | null;
  dt_solicitacao:          string | null;  // ISO "YYYY-MM-DD"
  responsavel:             string | null;
  excluir_media:           boolean;
  justificativa_exclusao:  string | null;
  empenho_realizado:       boolean;
  justificativa_atraso:    string | null;
  status:                  string | null;
  nr_documento:            string | null;
}

interface Props { canSync?: boolean; userRole?: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtValor(v?: number | null) {
  if (!v && v !== 0) return "–";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
  const parts = s.split("/");
  if (parts.length === 3) return new Date(+parts[2], +parts[1] - 1, +parts[0]);
  return null;
}

const RESPONSAVEIS = ["3S ANNE", "3S ELAINE", "2T BRUNO"] as const;
const TARGETS: Record<string, number> = { "3S ANNE": 0.4, "3S ELAINE": 0.4, "2T BRUNO": 0.2 };

const PERFIS_RELEVANTES = [
  "DA | EMPENHOS",
  "SEO (INCLUSÃO EMPENHO ASSINADO E/OU AUTUAÇÃO DE EMPENHOS)",
  "SEO (RENOMEAR EMPENHO)",
  "SEO - (EMISSÃO DE EMPENHO)",
] as const;

function isPerfilRelevante(p: string | null | undefined): boolean {
  return PERFIS_RELEVANTES.some(r => (p ?? "").trim() === r);
}

function isPerfilEmissao(p: string | null | undefined): boolean {
  return (p ?? "").trim() === "SEO - (EMISSÃO DE EMPENHO)";
}

function distribuirResponsaveis(
  sols: string[],
  baseCounts: { "3S ANNE": number; "3S ELAINE": number; "2T BRUNO": number }
): Record<string, string> {
  const counts = { ...baseCounts };
  const result: Record<string, string> = {};
  for (const sol of sols) {
    const total = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
    let best = RESPONSAVEIS[0] as string;
    let bestDef = -Infinity;
    for (const r of RESPONSAVEIS) {
      const def = TARGETS[r] - (total > 0 ? counts[r] / total : 0);
      if (def > bestDef) { bestDef = def; best = r; }
    }
    result[sol] = best;
    counts[best as keyof typeof counts]++;
  }
  return result;
}

function isPendenteOD(ne: EmpenhoNF): boolean {
  const ass = (ne.assinatura ?? "").toUpperCase();
  const pend = (ne.pendente_od ?? "").toUpperCase();
  return ass === "SEM INFORMACAO" || pend === "PENDENTE";
}

function statusAssinaturaOD(ne: EmpenhoNF): string {
  const ass = (ne.assinatura ?? "").toUpperCase();
  if (ass === "SEM INFORMACAO") return "Pendente de Assinatura OD";
  if ((ne.pendente_od ?? "").toUpperCase() === "PENDENTE") return "Pendente de Ratificação OD";
  return "";
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "–";
  const d = parseDate(s);
  if (!d || isNaN(d.getTime())) return s;
  return d.toLocaleDateString("pt-BR");
}

// ─── Bookmarklet SILOMS ───────────────────────────────────────────────────────
// Lista de NEs embutida ao gerar. Usa DOM vivo (igual ao Playwright). Grava no
// Supabase se houver internet; caso contrário baixa JSON para upload no GAP-MN.
const SILOMS_BOOKMARKLET_TEMPLATE = `(function(){
'use strict';
if(!location.href.includes('siloms')&&!location.href.includes('intraer')){
  alert('GAP-MN · SILOMS\\n\\nAbra o SILOMS, faça login, navegue até\\nDocumentos > Documentos na Unidade\\ne clique este favorito lá.');
  return;
}
var SB='https://fychrtyyqbzlfbzbvzqp.supabase.co';
var SK='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';
var NE_LIST=”__NE_LIST__”;
var hud=document.createElement('div');
hud.style.cssText='position:fixed;top:10px;right:10px;z-index:99999;background:#1e3a8a;color:#fff;padding:14px 18px;border-radius:14px;font:13px/1.7 system-ui,sans-serif;min-width:280px;max-width:360px;box-shadow:0 6px 24px rgba(0,0,0,.5);';
document.body.appendChild(hud);
function ui(m){hud.innerHTML='<b style=”font-size:14px”>&#9881;&#65039; GAP-MN SILOMS</b><br>'+m;}
function w(ms){return new Promise(function(r){setTimeout(r,ms)});}
function extractNr(doc){
  var tbls=Array.from(doc.querySelectorAll('table'));
  for(var i=0;i<tbls.length;i++){
    var ths=Array.from(tbls[i].querySelectorAll('th')).map(function(th){return(th.textContent||'').trim().toLowerCase();});
    var iN=ths.findIndex(function(h){return h.startsWith('nr')||h.includes('n\\u00famero')||h.includes('n\\u00ba')||h.includes('doc');});
    if(iN<0)continue;
    var rows=Array.from(tbls[i].querySelectorAll('tr')).filter(function(tr){return tr.querySelectorAll('td').length>1;});
    for(var j=0;j<rows.length;j++){
      var cells=Array.from(rows[j].querySelectorAll('td')).map(function(td){return(td.textContent||'').trim();});
      if(cells[iN]&&/[0-9]/.test(cells[iN]))return cells[iN];
    }
  }
  return null;
}
function getLiveForm(){
  var f=document.querySelector('form');
  if(f)return{form:f,base:location.href};
  var frs=Array.from(document.querySelectorAll('iframe,frame'));
  for(var i=0;i<frs.length;i++){
    try{var d=frs[i].contentDocument;var ff=d&&d.querySelector('form');if(ff)return{form:ff,base:d.location.href};}catch(_){}
  }
  return null;
}
async function searchNE(ne,status){
  var lf=getLiveForm();if(!lf)return null;
  var form=lf.form,base=lf.base;
  var inputs=Array.from(form.querySelectorAll(“input[type='text'],input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button']):not([type='image']):not([type='file'])”));
  var nomeEl=null;
  for(var m=0;m<inputs.length;m++){var n=(inputs[m].name||inputs[m].id||'').toLowerCase();if(n.includes('nome')||n.includes('descri')){nomeEl=inputs[m];break;}}
  if(!nomeEl&&inputs.length)nomeEl=inputs[0];
  if(!nomeEl)return null;
  nomeEl.value=ne;
  nomeEl.dispatchEvent(new Event('input',{bubbles:true}));
  nomeEl.dispatchEvent(new Event('change',{bubbles:true}));
  Array.from(form.querySelectorAll(“input[type='checkbox']”)).forEach(function(cb){
    var lbl='';
    try{lbl=((cb.labels&&cb.labels[0]?cb.labels[0].textContent:'')||(cb.closest&&cb.closest('label')?cb.closest('label').textContent:'')||'').toLowerCase();}catch(_){}
    if((lbl.includes('perfil')||lbl.includes('somente'))&&cb.checked){cb.checked=false;cb.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  Array.from(form.querySelectorAll('select')).some(function(sel){
    var opt=Array.from(sel.options).find(function(o){return(o.text||'').toLowerCase().includes(status.toLowerCase());});
    if(opt){sel.value=opt.value;sel.dispatchEvent(new Event('change',{bubbles:true}));return true;}
    return false;
  });
  var rawAction=form.getAttribute('action')||base;
  var action;try{action=new URL(rawAction,base).href;}catch(_){action=base;}
  var fd=new URLSearchParams();
  Array.from(form.elements).forEach(function(el){
    if(!el.name||el.disabled)return;
    if(el.type==='submit'||el.type==='button'||el.type==='image')return;
    if(el.type==='checkbox'&&!el.checked)return;
    if(el.type==='radio'&&!el.checked)return;
    fd.append(el.name,el.value||'');
  });
  var imgBtn=Array.from(form.querySelectorAll(“input[type='image']”)).find(function(b){var src=(b.src||b.getAttribute('src')||'').toLowerCase();return src.includes('pesquis')||src.includes('bino')||src.includes('lupa')||src.includes('search');});
  if(imgBtn&&imgBtn.name){fd.set(imgBtn.name+'.x','10');fd.set(imgBtn.name+'.y','10');}
  else{var sb=form.querySelector(“input[type='submit'],button[type='submit']”);if(sb&&sb.name)fd.set(sb.name,sb.value||'ok');}
  var res=await fetch(action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fd.toString(),credentials:'include'});
  if(!res.ok)return null;
  var html=await res.text();
  var rDoc=new DOMParser().parseFromString(html,'text/html');
  var newVS=rDoc.querySelector('input[name=”javax.faces.ViewState”]');
  var liveVS=form.querySelector('input[name=”javax.faces.ViewState”]');
  if(newVS&&liveVS)liveVS.value=newVS.value;
  return extractNr(rDoc);
}
async function saveSupabase(results){
  var ok=0;var h={'apikey':SK,'Authorization':'Bearer '+SK,'Content-Type':'application/json','Prefer':'return=minimal'};
  for(var i=0;i<results.length;i++){
    try{var r=await fetch(SB+'/rest/v1/siloms_ne_identificadores?ne_siafi=eq.'+encodeURIComponent(results[i].ne_siafi),{method:'PATCH',headers:h,body:JSON.stringify({subprocesso:results[i].subprocesso})});if(r.ok)ok++;}catch(_){}
  }
  return ok;
}
function dlJson(results){
  var blob=new Blob([JSON.stringify(results,null,2)],{type:'application/json'});
  var url=URL.createObjectURL(blob);var a=document.createElement('a');
  a.href=url;a.download='siloms_subprocessos.json';
  document.body.appendChild(a);a.click();
  setTimeout(function(){if(a.parentNode)a.parentNode.removeChild(a);URL.revokeObjectURL(url);},3000);
}
(async function(){
  ui('&#128269; Verificando formul&#225;rio...');
  if(!getLiveForm()){ui('&#10060; Formul&#225;rio n&#227;o encontrado.<br><b>Navegue para:</b><br>Documentos &#8594; Documentos na Unidade<br>e clique este favorito novamente.');return;}
  if(!NE_LIST.length){ui('&#9989; Nenhuma NE pendente! Todas j&#225; t&#234;m subprocesso.');setTimeout(function(){if(document.contains(hud))hud.remove();},6000);return;}
  if(!confirm('GAP-MN · SILOMS\\n\\n'+NE_LIST.length+' NE(s) sem subprocesso.\\n\\nO rob\\u00f4 preencher\\u00e1 o campo Nome para cada NE,\\npesquisar\\u00e1 Ativo e Arquivado e registrar\\u00e1 o Nr. Documento.\\n\\nSalva no Supabase se houver internet,\\ncaso contr\\u00e1rio baixa JSON para upload no GAP-MN.\\n\\nIniciar?'))return;
  var results=[];var ok=0;
  for(var i=0;i<NE_LIST.length;i++){
    var ne=NE_LIST[i];var sub=null;
    for(var si=0;si<2;si++){
      var st=si===0?'Ativo':'Arquivado';
      ui('&#9203; '+(i+1)+'/'+NE_LIST.length+'<br><b>'+ne+'</b><br>Buscando ('+st+')...');
      try{sub=await searchNE(ne,st);}catch(e){}
      if(sub)break;
      await w(400);
    }
    results.push({ne_siafi:ne,subprocesso:sub||''});
    if(sub){ok++;ui('&#9989; '+(i+1)+'/'+NE_LIST.length+'<br><b>'+ne+'</b><br>&#8594; '+sub);}
    else{ui('&#9898; '+(i+1)+'/'+NE_LIST.length+'<br><b>'+ne+'</b><br>N&#227;o encontrado');}
    await w(500);
  }
  ui('&#128190; Salvando '+results.length+' resultados...');
  try{
    var saved=await saveSupabase(results);
    if(!saved)throw new Error('0');
    ui('&#127881; Conclu&#237;do!<br><b>'+ok+'/'+NE_LIST.length+'</b> subprocessos encontrados<br>&#9989; '+saved+' salvos no Supabase');
  }catch(e){
    dlJson(results);
    ui('&#127881; Conclu&#237;do!<br><b>'+ok+'/'+NE_LIST.length+'</b> subprocessos encontrados<br>&#128190; JSON baixado (sem Supabase)<br><small>GAP-MN &#8594; &#8679; Resultado Rob&#244;</small>');
  }
  setTimeout(function(){if(document.contains(hud))hud.remove();},20000);
})();
})();`;

// ─── Bookmarklet "Leitor de Tabela" ──────────────────────────────────────────
// Lê a tabela já visível na página do SILOMS (o usuário fez a pesquisa).
// Extrai Nr.Documento, NEs do Nome e Perfil Unidade Atual.
// Envia direto ao Supabase — sem preencher formulário, sem navegação.
const SILOMS_LEITOR_BOOKMARKLET = `(function(){
'use strict';
if(!location.href.includes('siloms')&&!location.href.includes('intraer')){
  alert('GAP-MN\\n\\nAbra o SILOMS, pesquise os documentos que deseja e clique este favorito.');
  return;
}
var SB='https://fychrtyyqbzlfbzbvzqp.supabase.co';
var SK='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';
var hud=document.createElement('div');
hud.style.cssText='position:fixed;top:10px;right:10px;z-index:99999;background:#0f4c81;color:#fff;padding:14px 18px;border-radius:14px;font:13px/1.7 system-ui,sans-serif;min-width:280px;max-width:380px;box-shadow:0 6px 24px rgba(0,0,0,.5);';
(document.body||document.documentElement).appendChild(hud);
function ui(m){hud.innerHTML='<b style="font-size:14px">&#9881;&#65039; GAP-MN · Leitor SILOMS</b><br>'+m;}
function getDoc(){
  var frs=Array.from(document.querySelectorAll('frame,iframe'));
  for(var i=0;i<frs.length;i++){try{var d=frs[i].contentDocument;if(d&&d.querySelector('table th'))return d;}catch(e){}}
  return document;
}
function extrairSol(nome){
  var m=nome.match(/\\b(26S\\d+)\\b/i);if(m)return m[1].toUpperCase();
  var o=nome.match(/Of[ií]cio\\s+([\\d\\/\\-]+)/i);if(o)return 'Ofício '+o[1];
  if(/di[áa]ria/i.test(nome))return 'Diárias';
  if(/suprimento/i.test(nome))return 'Suprimento';
  return null;
}
var PERFIS_REL=['DA | EMPENHOS','SEO (INCLUSÃO EMPENHO ASSINADO E/OU AUTUAÇÃO DE EMPENHOS)','SEO (RENOMEAR EMPENHO)','SEO - (EMISSÃO DE EMPENHO)'];
function isRelev(p){return PERFIS_REL.some(function(r){return(p||'').trim()===r;});}
function isEmissao(p){return(p||'').trim()==='SEO - (EMISSÃO DE EMPENHO)';}
function parseTabela(doc){
  var neRows=[];var emissaoRows=[];
  var tables=Array.from(doc.querySelectorAll('table'));
  for(var t=0;t<tables.length;t++){
    var ths=Array.from(tables[t].querySelectorAll('th')).map(function(th){return(th.textContent||'').trim().toLowerCase();});
    var iNr=ths.findIndex(function(h){return(h.includes('nr.')&&h.includes('doc'))||h==='nr. documento';});
    var iNome=ths.findIndex(function(h){return h==='nome';});
    var iPerfil=ths.findIndex(function(h){return h.includes('perfil')&&h.includes('unidade')&&h.includes('atual');});
    if(iNr<0||iNome<0)continue;
    var rows=Array.from(tables[t].querySelectorAll('tr')).filter(function(tr){return tr.querySelectorAll('td').length>1;});
    for(var r=0;r<rows.length;r++){
      var cells=Array.from(rows[r].querySelectorAll('td')).map(function(td){return(td.textContent||'').trim();});
      var nrDoc=(cells[iNr]||'').trim();
      var nome=(cells[iNome]||'').trim();
      var perfil=iPerfil>=0?(cells[iPerfil]||'').trim():'';
      if(!/^\\d{3,10}$/.test(nrDoc))continue;
      var nes=nome.match(/2026NE\\d+/gi);
      if(nes){
        var perfilFinal=isRelev(perfil)?perfil:'';
        var sol=extrairSol(nome);
        for(var n=0;n<nes.length;n++)neRows.push({ne_siafi:nes[n].toUpperCase(),subprocesso:nrDoc,perfil_atual:perfilFinal,solicitacao:sol});
      }else if(isEmissao(perfil)){
        var seM=nome.match(/\\b(26[SM]\\d{3,6})\\b/i);
        var solE=seM?seM[1].toUpperCase():nome.trim();
        emissaoRows.push({solicitacao:solE,nr_documento:nrDoc,perfil_atual:perfil});
      }
    }
  }
  var merged={};
  for(var i=0;i<neRows.length;i++){
    var r=neRows[i];
    if(merged[r.ne_siafi]){var pts=merged[r.ne_siafi].subprocesso.split(', ');if(pts.indexOf(r.subprocesso)<0)merged[r.ne_siafi].subprocesso=pts.concat(r.subprocesso).join(', ');}
    else{merged[r.ne_siafi]=Object.assign({},r);}
  }
  var emSeen={};var emFinal=emissaoRows.filter(function(r){if(emSeen[r.solicitacao])return false;emSeen[r.solicitacao]=true;return true;});
  return {neList:Object.values(merged),emissaoList:emFinal};
}
(async function(){
  ui('&#128269; Lendo tabela...');
  var doc=getDoc();
  var parsed=parseTabela(doc);
  var lista=parsed.neList;var emLista=parsed.emissaoList;
  if(!lista.length&&!emLista.length){ui('&#10060; Nenhuma NE ou doc de emiss\\u00e3o encontrado.<br><small>Certifique-se de estar em <b>Documentos na Unidade</b> com resultados vis\\u00edveis.</small>');setTimeout(function(){if(document.contains(hud))hud.remove();},6000);return;}
  var preview='';
  if(lista.length)preview+=lista.slice(0,6).map(function(r){return r.ne_siafi+'\\u2192 Doc.'+r.subprocesso+(r.perfil_atual?'':' (ACI)');}).join('\\n')+(lista.length>6?'\\n...':'');
  if(emLista.length)preview+=(preview?'\\n':'')+'[EMISS\\u00c3O]\\n'+emLista.slice(0,4).map(function(r){return r.solicitacao+'\\u2192 Doc.'+r.nr_documento;}).join('\\n')+(emLista.length>4?'\\n...':'');
  var totalStr=(lista.length?lista.length+' NE(s)':'')+(emLista.length?(lista.length?' + ':'')+emLista.length+' emiss\\u00e3o':'');
  if(!confirm('GAP-MN \\u00b7 SILOMS\\n\\n'+totalStr+'\\n\\n'+preview+'\\n\\nSalvar no Supabase?')){hud.remove();return;}
  ui('&#9587; Buscando registros existentes...');
  var h={'apikey':SK,'Authorization':'Bearer '+SK,'Content-Type':'application/json','Prefer':'return=minimal'};
  var existing={};
  if(lista.length){
    try{
      var neIds=lista.map(function(r){return r.ne_siafi;});
      var gRes=await fetch(SB+'/rest/v1/siloms_ne_identificadores?ne_siafi=in.('+neIds.map(function(n){return '"'+n+'"';}).join(',')+')'+'&select=ne_siafi,subprocesso,solicitacao',{headers:{'apikey':SK,'Authorization':'Bearer '+SK}});
      if(gRes.ok){var gData=await gRes.json();for(var i=0;i<gData.length;i++)existing[gData[i].ne_siafi]=gData[i];}
    }catch(e){}
  }
  var ok=0,errs=0,novos=0,emOk=0;
  var errLog=[];
  for(var i=0;i<lista.length;i++){
    var r=lista[i];
    ui('&#128190; '+(i+1)+'/'+(lista.length+emLista.length)+' '+r.ne_siafi+'...');
    var ex=existing[r.ne_siafi];
    var bancoPts=(ex&&ex.subprocesso?ex.subprocesso.split(/,\\s*/):[''].filter(Boolean));
    var novoPts=r.subprocesso.split(/,\\s*/).filter(Boolean);
    var subFinal=[].concat(bancoPts,novoPts.filter(function(s){return bancoPts.indexOf(s)<0;})).join(', ');
    var payload={subprocesso:subFinal,perfil_atual:r.perfil_atual};
    if(r.solicitacao&&!(ex&&ex.solicitacao))payload.solicitacao=r.solicitacao;
    var res;
    if(ex){res=await fetch(SB+'/rest/v1/siloms_ne_identificadores?ne_siafi=eq.'+encodeURIComponent(r.ne_siafi),{method:'PATCH',headers:h,body:JSON.stringify(payload)});}
    else{res=await fetch(SB+'/rest/v1/siloms_ne_identificadores',{method:'POST',headers:h,body:JSON.stringify(Object.assign({ne_siafi:r.ne_siafi,identificador:''},payload))});if(res&&res.ok)novos++;}
    if(res&&res.ok){ok++;}else{
      errs++;
      var errTxt='';try{errTxt=await res.text();}catch(_){}
      var desc=r.ne_siafi+' [HTTP '+(res?res.status:'sem resp')+'] '+errTxt.slice(0,120);
      console.error('[SILOMS Leitor]',desc);
      errLog.push(desc);
      ui('&#10060; ERRO: '+r.ne_siafi+'<br><small>HTTP '+(res?res.status:'?')+' \\u2014 '+errTxt.slice(0,80).replace(/</g,'&lt;')+'</small>');
      await new Promise(function(r){setTimeout(r,2000);});
    }
  }
  // Emissão rows → siloms_solicitacoes
  if(emLista.length){
    var solSols={};
    try{
      var solIds=emLista.map(function(r){return r.solicitacao;});
      var sRes=await fetch(SB+'/rest/v1/siloms_solicitacoes?select=solicitacao,nr_documento&solicitacao=in.('+solIds.map(function(s){return'"'+s+'"';}).join(',')+')',{headers:{'apikey':SK,'Authorization':'Bearer '+SK}});
      if(sRes.ok){var sData=await sRes.json();for(var i=0;i<sData.length;i++)solSols[sData[i].solicitacao]=sData[i];}
    }catch(e){}
    for(var j=0;j<emLista.length;j++){
      var er=emLista[j];
      ui('&#128196; Emiss\\u00e3o '+(j+1)+'/'+emLista.length+': '+er.solicitacao+'...');
      var exSol=solSols[er.solicitacao];
      var eres;
      if(exSol){
        if(!exSol.nr_documento){eres=await fetch(SB+'/rest/v1/siloms_solicitacoes?solicitacao=eq.'+encodeURIComponent(er.solicitacao),{method:'PATCH',headers:h,body:JSON.stringify({nr_documento:er.nr_documento})});}
        else{ok++;continue;}
      }else{eres=await fetch(SB+'/rest/v1/siloms_solicitacoes',{method:'POST',headers:h,body:JSON.stringify({solicitacao:er.solicitacao,nr_documento:er.nr_documento,status:null,empenho_realizado:false,excluir_media:false})});if(eres&&eres.ok)novos++;}
      if(eres&&eres.ok){ok++;emOk++;}else{
        errs++;
        var errTxtE='';try{errTxtE=await eres.text();}catch(_){}
        var descE='SE:'+er.solicitacao+' [HTTP '+(eres?eres.status:'sem resp')+'] '+errTxtE.slice(0,120);
        console.error('[SILOMS Leitor]',descE);
        errLog.push(descE);
        ui('&#10060; ERRO emiss\\u00e3o: '+er.solicitacao+'<br><small>HTTP '+(eres?eres.status:'?')+' \\u2014 '+errTxtE.slice(0,80).replace(/</g,'&lt;')+'</small>');
        await new Promise(function(r){setTimeout(r,2000);});
      }
    }
  }
  var total=lista.length+emLista.length;
  var errDetail=errLog.length?'<br><small style="color:#fca5a5;word-break:break-all">'+errLog.map(function(e){return e.replace(/</g,'&lt;');}).join('<br>')+'</small>':'';
  var msg='&#127881; Conclu\\u00eddo!<br><b>'+ok+'/'+total+'</b> registros salvos'+(novos?' ('+novos+' novos)':'')+(emOk?' &#128196; '+emOk+' emiss\\u00e3o':'')+(errs?'<br>&#10060; '+errs+' erro(s):'+errDetail:'')+'<br><small style="color:#93c5fd">GAP-MN \\u2192 Empenhos \\u2192 Atualizar</small>';
  ui(msg);
  setTimeout(function(){if(document.contains(hud))hud.remove();},15000);
})();
})();`;

// ─── Bookmarklet "SE Leitor" — lê tabela SE Recebidas OU Documentos na Unidade ─
// Modo 1 (SE Recebidas): coluna "Solicitação" → insere novas SEs
// Modo 2 (Docs na Unidade): coluna "Nr. Documento" → filtra "SOLICITA" + Ativo, faz UPSERT com nr_documento
const SILOMS_SE_LEITOR_BOOKMARKLET = `(function(){'use strict';
if(!location.href.includes('siloms')&&!location.href.includes('intraer')){
  alert('GAP-MN\\n\\nAbra o SILOMS (SE Recebidas ou Documentos na Unidade) e clique este favorito.');return;
}
var SB='https://fychrtyyqbzlfbzbvzqp.supabase.co';
var SK='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Y2hydHl5cWJ6bGZiemJ2enFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5Mzk5NzcsImV4cCI6MjA4NjUxNTk3N30.i27qaCYX9qZ6liL9iXaOtYgddWgKyiM5eoobIN1loFw';
var hud=document.createElement('div');
hud.style.cssText='position:fixed;top:10px;right:10px;z-index:99999;background:#0c4a6e;color:#fff;padding:14px 18px;border-radius:14px;font:13px/1.7 system-ui,sans-serif;min-width:280px;max-width:380px;box-shadow:0 6px 24px rgba(0,0,0,.5);';
(document.body||document.documentElement).appendChild(hud);
function ui(m){hud.innerHTML='<b style="font-size:14px">&#128196; GAP-MN \\u00b7 SE Leitor</b><br>'+m;}
function getDoc(){
  var frs=Array.from(document.querySelectorAll('frame,iframe'));
  for(var i=0;i<frs.length;i++){try{var d=frs[i].contentDocument;if(d&&d.querySelector('table'))return d;}catch(e){}}
  return document;
}
function parseDt(s){
  if(!s)return null;
  var p=s.trim().split('/');
  if(p.length!==3)return null;
  return p[2]+'-'+(p[1].length<2?'0'+p[1]:p[1])+'-'+(p[0].length<2?'0'+p[0]:p[0]);
}
function parseTudo(doc){
  var seRows=[];var subRows=[];
  var tables=Array.from(doc.querySelectorAll('table'));
  for(var t=0;t<tables.length;t++){
    var ths=Array.from(tables[t].querySelectorAll('th')).map(function(th){return(th.textContent||'').trim().toLowerCase().replace(/\\s+/g,' ');});
    if(!ths.length)continue;
    var iSol=ths.findIndex(function(h){return h==='solicitação'||h==='solicitacao'||h.startsWith('solicit');});
    var iNrDoc=ths.findIndex(function(h){return(h.includes('nr')&&h.includes('doc'))||h==='nr. documento';});
    var iNome=ths.findIndex(function(h){return h==='nome';});
    var iSt=ths.findIndex(function(h){return h==='status';});
    var iUgCred=ths.findIndex(function(h){return h.replace(/\\s/g,'')==='ugcred'||h.includes('ug')&&h.includes('cred');});
    var iDt=ths.findIndex(function(h){return(h.includes('dt')||h.includes('data'))&&h.includes('solic');});
    var iUO=ths.findIndex(function(h){return h.includes('unidade')&&h.includes('origem');});
    var iDtAb=ths.findIndex(function(h){return h.includes('data')&&(h.includes('aber')||h.includes('abertura'));});
    if(iUgCred<0)iUgCred=2;
    if(iDt<0)iDt=13;
    var rows=Array.from(tables[t].querySelectorAll('tr')).filter(function(tr){return tr.querySelectorAll('td').length>1;});
    if(iSol>=0){
      for(var r=0;r<rows.length;r++){
        var c=Array.from(rows[r].querySelectorAll('td')).map(function(td){return(td.textContent||'').trim();});
        var sol=(c[iSol]||'').trim();
        if(!sol||!/^\\d{2}[A-Z]\\d+$/i.test(sol))continue;
        seRows.push({solicitacao:sol.toUpperCase(),ug_cred:(c[iUgCred]||'').trim()||null,dt_solicitacao:parseDt((c[iDt]||'').trim()),status:(iSt>=0?(c[iSt]||'').trim():null)||null,nr_documento:null});
      }
    } else if(iNrDoc>=0&&iNome>=0){
      for(var r=0;r<rows.length;r++){
        var c=Array.from(rows[r].querySelectorAll('td')).map(function(td){return(td.textContent||'').trim();});
        var nrDoc=(c[iNrDoc]||'').trim();
        var nome=(c[iNome]||'').trim();
        var st=(iSt>=0?(c[iSt]||'').trim():'')||'';
        if(!/^\\d{3,10}$/.test(nrDoc))continue;
        if(!nome.toUpperCase().includes('SOLICITA'))continue;
        if(st.toLowerCase()!=='ativo')continue;
        var seMatch=nome.match(/\\b(26[SM]\\d{3,6})\\b/i);
        var solicitacao=seMatch?seMatch[1].toUpperCase():nome.trim();
        subRows.push({solicitacao:solicitacao,nr_documento:nrDoc,ug_cred:(iUO>=0?(c[iUO]||'').trim():null)||null,dt_solicitacao:parseDt(iDtAb>=0?(c[iDtAb]||'').trim():''),status:null});
      }
    }
  }
  function dedup(arr){var s={};return arr.filter(function(r){if(s[r.solicitacao])return false;s[r.solicitacao]=true;return true;});}
  return {seRows:dedup(seRows),subRows:dedup(subRows)};
}
(async function(){
  ui('&#128269; Lendo tabela...');
  var doc=getDoc();
  var parsed=parseTudo(doc);
  var seRows=parsed.seRows,subRows=parsed.subRows;
  var total=seRows.length+subRows.length;
  if(!total){
    ui('&#10060; Nenhuma SE encontrada.<br><small>Certifique-se de estar em <b>SE Recebidas</b> ou <b>Documentos na Unidade</b> (SOLICITA\\u00c7\\u00c3O DE EMPENHO, Ativo) com resultados vis\\u00edveis.</small>');
    setTimeout(function(){if(document.contains(hud))hud.remove();},8000);return;
  }
  var preview='';
  if(seRows.length)preview+='SE Recebidas: '+seRows.length+'\\n'+seRows.slice(0,4).map(function(r){return r.solicitacao+(r.status?' ('+r.status+')':'');}).join('\\n')+(seRows.length>4?'\\n...':'')+' \\n';
  if(subRows.length)preview+='Subprocessos: '+subRows.length+'\\n'+subRows.slice(0,4).map(function(r){return r.solicitacao+' \\u2192 Doc.'+r.nr_documento;}).join('\\n')+(subRows.length>4?'\\n...':'');
  if(!confirm('GAP-MN \\u00b7 SE Leitor\\n\\n'+preview.trim()+'\\n\\nSalvar no Supabase?')){hud.remove();return;}
  var h={'apikey':SK,'Authorization':'Bearer '+SK,'Content-Type':'application/json'};
  var ph=Object.assign({},h,{'Prefer':'return=minimal'});
  ui('&#9587; Verificando existentes...');
  var allSols=[].concat(seRows,subRows).map(function(r){return r.solicitacao;});
  var existing={};
  try{
    var gRes=await fetch(SB+'/rest/v1/siloms_solicitacoes?select=solicitacao,nr_documento&solicitacao=in.('+allSols.map(function(s){return'"'+s+'"';}).join(',')+')',{headers:h});
    if(gRes.ok){var gData=await gRes.json();for(var i=0;i<gData.length;i++)existing[gData[i].solicitacao]=gData[i];}
  }catch(e){}
  var ok=0,errs=0,novos=0,atualizados=0,empenhados=0;
  // SE RECEBIDAS: insere novas; detecta saídas da lista (→ marca empenho_realizado)
  for(var i=0;i<seRows.length;i++){
    var r=seRows[i];
    ui('&#128196; SE '+(i+1)+'/'+seRows.length+': '+r.solicitacao+'...');
    if(existing[r.solicitacao]){ok++;continue;}
    var res=await fetch(SB+'/rest/v1/siloms_solicitacoes',{method:'POST',headers:ph,body:JSON.stringify([r])});
    if(res&&res.ok){ok++;novos++;}else{errs++;}
  }
  // Se viemos da página SE Recebidas, marca como empenhadas as que sumiram da lista
  if(seRows.length>0){
    ui('&#128269; Verificando SEs que sa\\u00edram da lista...');
    var currentSols=new Set(seRows.map(function(r){return r.solicitacao;}));
    try{
      var staleRes=await fetch(SB+'/rest/v1/siloms_solicitacoes?select=solicitacao&status=eq.Assinada+OD+UGCred&empenho_realizado=eq.false',{headers:h});
      if(staleRes.ok){
        var staleData=await staleRes.json();
        var toEmp=staleData.filter(function(r){return!currentSols.has(r.solicitacao);});
        for(var j=0;j<toEmp.length;j++){
          var er=await fetch(SB+'/rest/v1/siloms_solicitacoes?solicitacao=eq.'+encodeURIComponent(toEmp[j].solicitacao),{method:'PATCH',headers:ph,body:JSON.stringify({empenho_realizado:true})});
          if(er&&er.ok)empenhados++;
        }
      }
    }catch(e){}
  }
  // Subprocessos: UPSERT
  for(var i=0;i<subRows.length;i++){
    var r=subRows[i];
    ui('&#128196; Sub '+(i+1)+'/'+subRows.length+': '+r.solicitacao+'...');
    var ex=existing[r.solicitacao];
    if(ex){
      if(!ex.nr_documento){
        var payload={nr_documento:r.nr_documento};
        if(r.ug_cred)payload.ug_cred=r.ug_cred;
        var res=await fetch(SB+'/rest/v1/siloms_solicitacoes?solicitacao=eq.'+encodeURIComponent(r.solicitacao),{method:'PATCH',headers:ph,body:JSON.stringify(payload)});
        if(res&&res.ok){ok++;atualizados++;}else{errs++;}
      }else{ok++;}
    }else{
      var res=await fetch(SB+'/rest/v1/siloms_solicitacoes',{method:'POST',headers:ph,body:JSON.stringify([r])});
      if(res&&res.ok){ok++;novos++;}else{errs++;}
    }
  }
  var msg='&#127881; Conclu\\u00eddo!<br><b>'+ok+'/'+total+'</b>'+(novos?' ('+novos+' novas)':'')+(atualizados?' ('+atualizados+' atualizadas)':'')+(empenhados?' \\u2014 &#9989; '+empenhados+' empenhadas':'')+(errs?'<br>&#10060; '+errs+' erros':'')+'<br><small style="color:#93c5fd">GAP-MN \\u2192 Empenhos \\u2192 Atualizar</small>';
  ui(msg);
  setTimeout(function(){if(document.contains(hud))hud.remove();},15000);
})();
})();`;

// ─── Componente ──────────────────────────────────────────────────────────────

export default function GerenciamentoEmpenhos({ canSync = false, userRole }: Props) {
  const canEdit          = ["SEO", "DEV", "ADMIN"].includes((userRole ?? "").toUpperCase());
  const canEditPendentes = ["SEO", "DEV"].includes((userRole ?? "").toUpperCase());

  // Dados
  const [empenhos,      setEmpenhos]      = useState<EmpenhoNF[]>([]);
  const [neIdents,      setNeIdents]      = useState<NeIdent[]>([]);
  const [solicitacoes,  setSolicitacoes]  = useState<SeSolicitacao[]>([]);
  const [loading,       setLoading]       = useState(false);

  // Expand linha
  const [expandedNE, setExpandedNE] = useState<string | null>(null);

  // Filtros
  const [busca,        setBusca]        = useState("");
  const [semSubproc,      setSemSubproc]      = useState(false);
  const [pendAssinatura,  setPendAssinatura]  = useState(false);
  const [perfilFiltro, setPerfilFiltro] = useState("");
  const [ugCredFiltro,       setUgCredFiltro]       = useState("");
  const [responsavelFiltro, setResponsavelFiltro] = useState("");

  // Modal "Excluir da média"
  const [showExcluirModal,    setShowExcluirModal]    = useState<string | null>(null);
  const [justificativaExcluir, setJustificativaExcluir] = useState("");

  const [showNEsTable, setShowNEsTable] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const id = "empenhos-dark-css";
    document.getElementById(id)?.remove();
    if (!darkMode) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      .empenhos-dark { background:#0d1117!important; }
      .empenhos-dark .rounded-2xl,
      .empenhos-dark .rounded-xl { background:#161b27!important; border-color:#1e2a3a!important; }
      .empenhos-dark .bg-white   { background:#161b27!important; }
      .empenhos-dark .bg-slate-50 { background:#1e2a3a!important; }
      .empenhos-dark thead th    { background:#1e2a3a!important; color:#94a3b8!important; }
      .empenhos-dark tbody tr    { border-color:#1e2a3a!important; }
      .empenhos-dark tbody tr:hover { background:#1a2535!important; }
      .empenhos-dark td, .empenhos-dark th { color:#94a3b8!important; }
      .empenhos-dark .text-sky-700 { color:#22d3ee!important; }
      .empenhos-dark .text-emerald-700 { color:#4ade80!important; }
      .empenhos-dark .text-slate-900,.empenhos-dark .text-slate-800 { color:#e2e8f0!important; }
      .empenhos-dark .text-slate-700,.empenhos-dark .text-slate-600 { color:#94a3b8!important; }
      .empenhos-dark .text-slate-500,.empenhos-dark .text-slate-400 { color:#64748b!important; }
      .empenhos-dark .border-slate-200,.empenhos-dark .border-slate-100 { border-color:#1e2a3a!important; }
      .empenhos-dark .shadow-sm { box-shadow:0 1px 3px #00000066!important; }
      .empenhos-dark input,.empenhos-dark select,.empenhos-dark textarea {
        background:#1e2a3a!important; color:#e2e8f0!important; border-color:#2d3f52!important; }
      .empenhos-dark .font-mono { color:#22d3ee!important; }
    `;
    document.head.appendChild(s);
    return () => document.getElementById(id)?.remove();
  }, [darkMode]);

  // Colar SE (Solicitações de Empenho)
  const [showColarSeModal, setShowColarSeModal] = useState(false);
  const [colarSeTab,       setColarSeTab]       = useState<"colar" | "robo">("colar");
  const [colarSeTexto,     setColarSeTexto]     = useState("");
  const [colarSeParsed,    setColarSeParsed]    = useState<{ solicitacao: string; ug_cred: string | null; dt_solicitacao: string | null; status: string | null; nr_documento: string | null }[]>([]);
  const [colarSeMsg,       setColarSeMsg]       = useState<string | null>(null);
  const [colarSeSalvando,  setColarSeSalvando]  = useState(false);
  const [copiedSeLeitor,   setCopiedSeLeitor]   = useState(false);

  // Modal "Subprocessos" (unifica Colar + Robô)
  const [showSubprocModal, setShowSubprocModal] = useState(false);
  const [subprocTab,       setSubprocTab]       = useState<"colar" | "robo">("colar");
  const [copied,           setCopied]           = useState(false);
  const [copiedConsole,    setCopiedConsole]    = useState(false);
  const [copiedLeitor,     setCopiedLeitor]     = useState(false);
  const leitorBookmarkRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.innerHTML = "";
    const a = document.createElement("a");
    const bmUrl = "javascript:" + encodeURIComponent(SILOMS_LEITOR_BOOKMARKLET);
    a.href = bmUrl;
    a.draggable = true;
    a.textContent = "📋 SILOMS Leitor";
    a.title = "Arraste para os favoritos — ou clique para copiar a URL e criar manualmente";
    a.className = "inline-block rounded-xl border-2 border-dashed border-teal-400 bg-teal-50 px-5 py-3 text-sm font-semibold text-teal-700 cursor-grab select-none hover:bg-teal-100 active:scale-95 transition-transform";
    a.onclick = e => {
      e.preventDefault();
      const orig = a.textContent;
      navigator.clipboard.writeText(bmUrl).then(() => {
        a.textContent = "✅ URL copiado!";
        setTimeout(() => { a.textContent = orig; }, 2500);
      }).catch(() => {
        prompt("Copie a URL abaixo e cole no campo URL de um novo favorito:", bmUrl);
      });
    };
    node.appendChild(a);
  }, []);

  const seLeitorBookmarkRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.innerHTML = "";
    const a = document.createElement("a");
    const seBmUrl = "javascript:" + encodeURIComponent(SILOMS_SE_LEITOR_BOOKMARKLET);
    a.href = seBmUrl;
    a.draggable = true;
    a.textContent = "📋 SE Leitor";
    a.title = "Arraste para os favoritos — ou clique para copiar a URL e criar manualmente";
    a.className = "inline-block rounded-xl border-2 border-dashed border-sky-400 bg-sky-50 px-5 py-3 text-sm font-semibold text-sky-700 cursor-grab select-none hover:bg-sky-100 active:scale-95 transition-transform";
    a.onclick = e => {
      e.preventDefault();
      const orig = a.textContent;
      navigator.clipboard.writeText(seBmUrl).then(() => {
        a.textContent = "✅ URL copiado!";
        setTimeout(() => { a.textContent = orig; }, 2500);
      }).catch(() => {
        prompt("Copie a URL abaixo e cole no campo URL de um novo favorito:", seBmUrl);
      });
    };
    node.appendChild(a);
  }, []);

  // (showColarModal removido — unificado em showSubprocModal)
  const [colarTexto,     setColarTexto]     = useState("");
  const [colarParsed,    setColarParsed]    = useState<{ ne_siafi: string; subprocesso: string; perfil_atual: string; solicitacao: string | null }[]>([]);
  const [colarMsg,       setColarMsg]       = useState<string | null>(null);
  const [colarSalvando,  setColarSalvando]  = useState(false);

  function extrairSolicitacao(nome: string): string | null {
    const s26 = nome.match(/\b(26S\d+)\b/i);
    if (s26) return s26[1].toUpperCase();
    const oficio = nome.match(/Of[ií]cio\s+([\d/\-]+)/i);
    if (oficio) return "Ofício " + oficio[1];
    if (/di[aá]ria/i.test(nome))  return "Diárias";
    if (/suprimento/i.test(nome)) return "Suprimento";
    return null;
  }

  // Returns NE rows (ne_siafi set) and emissão rows (ne_siafi = "" for docs without 2026NE in EMISSÃO perfil)
  function parseSilomsTable(texto: string): { ne_siafi: string; subprocesso: string; perfil_atual: string; solicitacao: string | null }[] {
    const linhas = texto.split(/\r?\n/).filter(l => l.trim());
    let iNr = -1, iNome = -1, iPerfil = -1, offset = 0;
    const brutos: { ne_siafi: string; subprocesso: string; perfil_atual: string; solicitacao: string | null }[] = [];

    for (const linha of linhas) {
      const cols = linha.split("\t");
      if (iNr < 0) {
        const norm = cols.map(c => c.trim().toLowerCase());
        iNr     = norm.findIndex(c => (c.includes("nr.") && c.includes("doc")) || c === "nr. documento");
        iNome   = norm.findIndex(c => c === "nome");
        iPerfil = norm.findIndex(c => c.includes("perfil") && c.includes("unidade") && c.includes("atual"));
        if (iNr >= 0) continue;
        continue;
      }
      if (offset === 0 && cols.length > 0 && cols[0].trim() === "") offset = 1;

      const nrDoc  = (cols[iNr     + offset] ?? "").trim();
      const nome   = (cols[iNome   + offset] ?? "").trim();
      const perfil = (cols[iPerfil + offset] ?? "").trim();

      if (!/^\d{3,10}$/.test(nrDoc)) continue;

      const neMatches = nome.match(/2026NE\d+/gi);
      if (neMatches) {
        // Doc with NE: save regardless of perfil; irrelevant perfil → perfil_atual = ""
        const perfilFinal = isPerfilRelevante(perfil) ? perfil : "";
        const solicitacao = extrairSolicitacao(nome);
        for (const ne of neMatches) {
          brutos.push({ ne_siafi: ne.toUpperCase(), subprocesso: nrDoc, perfil_atual: perfilFinal, solicitacao });
        }
      } else if (isPerfilEmissao(perfil)) {
        // Doc in EMISSÃO perfil without NE → emissão row (ne_siafi = "")
        const seMatch = nome.match(/\b(26[SM]\d{3,6})\b/i);
        const solicitacao = seMatch ? seMatch[1].toUpperCase() : nome.trim();
        brutos.push({ ne_siafi: "", subprocesso: nrDoc, perfil_atual: perfil, solicitacao });
      }
    }

    // Mescla entradas com a mesma ne_siafi (NE rows): concatena subprocessos distintos
    const merged = new Map<string, { ne_siafi: string; subprocesso: string; perfil_atual: string; solicitacao: string | null }>();
    for (const r of brutos) {
      if (r.ne_siafi === "") {
        // Emissão rows: keep all (deduplicate by solicitacao)
        if (!merged.has("__em__" + r.solicitacao)) merged.set("__em__" + r.solicitacao, { ...r });
        continue;
      }
      if (merged.has(r.ne_siafi)) {
        const ex = merged.get(r.ne_siafi)!;
        const lista = ex.subprocesso.split(", ");
        if (!lista.includes(r.subprocesso)) ex.subprocesso = [...lista, r.subprocesso].join(", ");
      } else {
        merged.set(r.ne_siafi, { ...r });
      }
    }
    return Array.from(merged.values());
  }

  async function salvarColar() {
    if (!colarParsed.length) return;
    setColarSalvando(true);
    setColarMsg("⏳ Salvando...");
    let ok = 0, errs = 0, inseridos = 0, emissaoOk = 0;
    const neIdentsMap = new Map(neIdents.map(n => [n.ne_siafi.toUpperCase(), n]));
    const solsMap = new Map(solicitacoes.map(s => [s.solicitacao.toUpperCase(), s]));

    for (const r of colarParsed) {
      // Emissão row (doc sem NE, perfil EMISSÃO) → atualiza/insere siloms_solicitacoes
      if (r.ne_siafi === "") {
        const sol = (r.solicitacao ?? "").toUpperCase();
        const existing = sol ? solsMap.get(sol) : undefined;
        if (existing) {
          if (!existing.nr_documento) {
            const { error } = await supabase.from("siloms_solicitacoes")
              .update({ nr_documento: r.subprocesso })
              .eq("solicitacao", existing.solicitacao);
            if (error) errs++; else { ok++; emissaoOk++; }
          } else { ok++; }
        } else {
          const { error } = await supabase.from("siloms_solicitacoes")
            .insert({ solicitacao: r.solicitacao!, nr_documento: r.subprocesso, status: null, empenho_realizado: false, excluir_media: false });
          if (error) errs++; else { ok++; emissaoOk++; inseridos++; }
        }
        continue;
      }

      const existing = neIdentsMap.get(r.ne_siafi);
      const bancoParts  = (existing?.subprocesso ?? "").split(/,\s*/).filter(Boolean);
      const novoParts   = r.subprocesso.split(/,\s*/).filter(Boolean);
      const subprocessoFinal = [...bancoParts, ...novoParts.filter(s => !bancoParts.includes(s))].join(", ");

      const payload: Record<string, string | null> = {
        subprocesso: subprocessoFinal,
        perfil_atual: r.perfil_atual,
      };
      if (r.solicitacao && !existing?.solicitacao) payload.solicitacao = r.solicitacao;

      if (existing) {
        const { error } = await supabase
          .from("siloms_ne_identificadores")
          .update(payload)
          .eq("ne_siafi", r.ne_siafi);
        if (error) errs++; else ok++;
      } else {
        const { error } = await supabase
          .from("siloms_ne_identificadores")
          .insert({ ne_siafi: r.ne_siafi, identificador: "", solicitacao: r.solicitacao ?? null, subprocesso: subprocessoFinal, perfil_atual: r.perfil_atual });
        if (error) errs++; else { ok++; inseridos++; }
      }
    }
    const extras = [inseridos ? `${inseridos} novos` : "", emissaoOk ? `${emissaoOk} emissão` : ""].filter(Boolean).join(", ");
    setColarMsg(`✅ ${ok} registro(s) salvos${extras ? ` (${extras})` : ""}${errs ? ` · ${errs} erros` : ""}`);
    setColarSalvando(false);
    await carregarNeIdentificadores();
    await carregarSolicitacoes();
  }

  // ── Parser tabela SE — detecta automaticamente formato SE RECEBIDAS ou Subprocesso ──
  function parseSETable(texto: string): { solicitacao: string; ug_cred: string | null; dt_solicitacao: string | null; status: string | null; nr_documento: string | null }[] {
    type Row = { solicitacao: string; ug_cred: string | null; dt_solicitacao: string | null; status: string | null; nr_documento: string | null };
    const linhas = texto.split(/\r?\n/).filter(l => l.trim());
    const resultados: Row[] = [];

    // ─── SE RECEBIDAS format ────────────────────────────────────────────────────
    let iSol = -1, iUgCred = -1, iDt = -1, iStatus = -1, iNome = -1;
    // ─── Subprocesso format ─────────────────────────────────────────────────────
    let iNrDoc = -1, iUO = -1, iDtAb = -1, iNomeS = -1, iStatusS = -1;

    let isSubprocessoFmt = false;
    let headerFound = false;
    let offset = 0;
    let offsetSet = false;

    for (const linha of linhas) {
      const cols = linha.split("\t");

      if (!headerFound) {
        // Strip leading empty cells to find header content
        const normAll = cols.map(c => c.trim().toLowerCase().replace(/\s+/g, " "));
        const norm = normAll[0] === "" ? normAll.slice(1) : normAll;
        const hdrOffset = normAll[0] === "" ? 1 : 0;

        const hasNrDoc = norm.some(c => c.includes("nr") && c.includes("doc"));
        const hasSol   = norm.some(c => c.startsWith("solicit"));

        if (hasNrDoc) {
          isSubprocessoFmt = true;
          iNrDoc   = hdrOffset + norm.findIndex(c => c.includes("nr") && c.includes("doc"));
          iNomeS   = hdrOffset + norm.findIndex(c => c === "nome" || c.startsWith("nome"));
          iUO      = hdrOffset + norm.findIndex(c => c.includes("unidade") && c.includes("origem"));
          iDtAb    = hdrOffset + norm.findIndex(c => c.includes("data") && c.includes("aber"));
          iStatusS = hdrOffset + norm.findIndex(c => c === "status" || c.includes("status"));
          headerFound = true;
          continue;
        } else if (hasSol) {
          isSubprocessoFmt = false;
          iSol    = hdrOffset + norm.findIndex(c => c.startsWith("solicit"));
          iUgCred = hdrOffset + norm.findIndex(c => c.replace(/\s/g, "") === "ugcred" || (c.includes("ug") && c.includes("cred")));
          iDt     = hdrOffset + norm.findIndex(c => (c.includes("dt") || c.includes("data")) && c.includes("solic"));
          if (iUgCred < hdrOffset) iUgCred = hdrOffset + 2;
          if (iDt     < hdrOffset) iDt     = hdrOffset + 13;
          iStatus = hdrOffset + norm.findIndex(c => c === "status" || c.includes("status"));
          iNome   = hdrOffset + norm.findIndex(c => c === "nome" || c.startsWith("nome"));
          headerFound = true;
          continue;
        }
        continue;
      }

      // Detect data row leading-empty offset once
      if (!offsetSet) {
        offset = cols[0].trim() === "" ? 1 : 0;
        offsetSet = true;
      }

      const parseDt = (raw: string) => {
        if (!raw) return null;
        const p = raw.split("/");
        return p.length === 3 ? `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}` : null;
      };

      if (isSubprocessoFmt) {
        const nrDoc = iNrDoc >= 0 ? (cols[iNrDoc + offset] ?? "").trim() : "";
        const nome  = iNomeS >= 0 ? (cols[iNomeS  + offset] ?? "").trim() : "";
        const uoVal = iUO    >= 0 ? (cols[iUO     + offset] ?? "").trim() : "";
        const dtRaw = iDtAb  >= 0 ? (cols[iDtAb   + offset] ?? "").trim() : "";

        if (!nrDoc || !/^\d{3,8}$/.test(nrDoc)) continue;
        if (/20\d{2}NE\d{3,}/i.test(nome)) continue;

        const seMatch = nome.match(/\b(\d{2}[SM]\d{3,6})\b/i);
        const solicitacao = seMatch ? seMatch[1].toUpperCase() : nome.trim() || nrDoc;

        resultados.push({
          solicitacao,
          ug_cred:        uoVal || null,
          dt_solicitacao: parseDt(dtRaw),
          status:         null,
          nr_documento:   nrDoc,
        });
      } else {
        if (iSol < 0) continue;
        const sol = (cols[iSol + offset] ?? "").trim();
        if (!sol || !/^\d{2}[A-Z]\d+$/i.test(sol)) continue;
        const ugCred    = iUgCred >= 0 ? (cols[iUgCred + offset] ?? "").trim() : "";
        const statusVal = iStatus >= 0 ? (cols[iStatus + offset] ?? "").trim() : "";
        const nomeVal   = iNome   >= 0 ? (cols[iNome   + offset] ?? "").trim() : "";
        const dtRaw     = iDt     >= 0 ? (cols[iDt     + offset] ?? "").trim() : "";
        resultados.push({
          solicitacao:    sol.toUpperCase(),
          ug_cred:        ugCred || null,
          dt_solicitacao: parseDt(dtRaw),
          status:         statusVal || null,
          nr_documento:   nomeVal || null,
        });
      }
    }

    const seen = new Set<string>();
    return resultados.filter(r => { if (seen.has(r.solicitacao)) return false; seen.add(r.solicitacao); return true; });
  }

  async function carregarSolicitacoes() {
    const { data, error } = await supabase.from("siloms_solicitacoes").select("*").limit(2000);
    if (error) console.error("[SE Sols]", error.message);
    if (data) setSolicitacoes(data as SeSolicitacao[]);
  }

  async function salvarColarSE(modo: "novas" | "substituir") {
    if (!colarSeParsed.length) return;
    setColarSeSalvando(true);
    setColarSeMsg("⏳ Salvando...");
    try {
      if (modo === "substituir") {
        const { error: delErr } = await supabase.from("siloms_solicitacoes").delete().gte("solicitacao", "");
        if (delErr) throw new Error(`Erro ao limpar: ${delErr.message}`);
      }
      const existingSols = new Set(solicitacoes.map(s => s.solicitacao.toUpperCase()));
      const registros = modo === "novas"
        ? colarSeParsed.filter(r => !existingSols.has(r.solicitacao.toUpperCase()))
        : colarSeParsed;
      if (!registros.length) { setColarSeMsg("✅ Nenhuma solicitação nova (todas já registradas)"); return; }

      // Auto-atribuir responsável (40% Anne · 40% Elaine · 20% Bruno)
      const base = modo === "substituir" ? [] : solicitacoes;
      const baseCounts = {
        "3S ANNE":   base.filter(s => s.responsavel === "3S ANNE").length,
        "3S ELAINE": base.filter(s => s.responsavel === "3S ELAINE").length,
        "2T BRUNO":  base.filter(s => s.responsavel === "2T BRUNO").length,
      };
      const assignments = distribuirResponsaveis(registros.map(r => r.solicitacao), baseCounts);
      const comResp = registros.map(r => ({ ...r, responsavel: assignments[r.solicitacao] }));

      let ok = 0, errs = 0;
      for (let i = 0; i < comResp.length; i += 100) {
        const lote = comResp.slice(i, i + 100);
        const { error } = await supabase.from("siloms_solicitacoes").insert(lote);
        if (error) errs += lote.length; else ok += lote.length;
      }
      setColarSeMsg(`✅ ${ok} solicitações ${modo === "novas" ? "adicionadas" : "importadas"}${errs ? ` · ${errs} erros` : ""}`);
      await carregarSolicitacoes();
    } catch (err: unknown) {
      setColarSeMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setColarSeSalvando(false);
    }
  }

  async function toggleExcluirMedia(solicitacao: string, excluir: boolean, justificativa?: string) {
    const { error } = await supabase
      .from("siloms_solicitacoes")
      .update({ excluir_media: excluir, justificativa_exclusao: excluir ? (justificativa ?? null) : null })
      .eq("solicitacao", solicitacao);
    if (!error) await carregarSolicitacoes();
  }

  async function atualizarResponsavel(solicitacao: string, responsavel: string) {
    const { error } = await supabase
      .from("siloms_solicitacoes")
      .update({ responsavel: responsavel || null })
      .eq("solicitacao", solicitacao);
    if (!error) setSolicitacoes(prev => prev.map(s => s.solicitacao === solicitacao ? { ...s, responsavel: responsavel || null } : s));
  }

  async function toggleEmpenhoRealizado(solicitacao: string, realizado: boolean) {
    const { error } = await supabase
      .from("siloms_solicitacoes")
      .update({ empenho_realizado: realizado })
      .eq("solicitacao", solicitacao);
    if (!error) setSolicitacoes(prev => prev.map(s => s.solicitacao === solicitacao ? { ...s, empenho_realizado: realizado } : s));
  }

  async function deletarSolicitacao(solicitacao: string) {
    if (!confirm(`Excluir "${solicitacao}" do banco de dados?\nEsta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("siloms_solicitacoes").delete().eq("solicitacao", solicitacao);
    if (!error) setSolicitacoes(prev => prev.filter(s => s.solicitacao !== solicitacao));
  }

  async function autoDistribuir() {
    const semResp = sePendentes.filter(s => !s.responsavel && !!s.status && !s.empenho_realizado);
    if (!semResp.length) return;
    const baseCounts = {
      "3S ANNE":   solicitacoes.filter(s => s.responsavel === "3S ANNE").length,
      "3S ELAINE": solicitacoes.filter(s => s.responsavel === "3S ELAINE").length,
      "2T BRUNO":  solicitacoes.filter(s => s.responsavel === "2T BRUNO").length,
    };
    const assignments = distribuirResponsaveis(semResp.map(s => s.solicitacao), baseCounts);
    for (const [sol, resp] of Object.entries(assignments)) {
      await supabase.from("siloms_solicitacoes").update({ responsavel: resp }).eq("solicitacao", sol);
    }
    await carregarSolicitacoes();
  }

  const buildCode = useCallback(() => {
    const nes = neIdents.filter(r => r.subprocesso === null || r.subprocesso === undefined).map(r => r.ne_siafi);
    return { code: SILOMS_BOOKMARKLET_TEMPLATE.replace('"__NE_LIST__"', JSON.stringify(nes)), nes };
  }, [neIdents]);

  const copyConsoleCode = useCallback(async () => {
    const { code } = buildCode();
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // fallback: create a temporary textarea
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedConsole(true);
    setTimeout(() => setCopiedConsole(false), 3000);
  }, [buildCode]);

  const copyBookmarklet = useCallback(async () => {
    const { code } = buildCode();
    try {
      await navigator.clipboard.writeText("javascript:" + encodeURIComponent(code));
    } catch {
      const ta = document.createElement("textarea");
      ta.value = "javascript:" + encodeURIComponent(code);
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [buildCode]);

  // Cria o <a> imperativammente — embute a lista de NEs no código, sem chamadas externas
  const silomsBookmarkRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const { code, nes } = buildCode();
    node.innerHTML = "";
    const a = document.createElement("a");
    a.href = "javascript:" + encodeURIComponent(code);
    a.draggable = true;
    a.textContent = "⚙️ SILOMS Subproc (" + nes.length + " NEs)";
    a.className = "inline-block rounded-xl border-2 border-dashed border-violet-400 bg-violet-50 px-5 py-3 text-sm font-semibold text-violet-700 cursor-grab select-none hover:bg-violet-100 active:scale-95 transition-transform";
    a.onclick = e => { e.preventDefault(); alert("Arraste este botão para a barra de favoritos.\nNão clique aqui diretamente."); };
    node.appendChild(a);
  }, [buildCode]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  async function carregarPlanilha() {
    setLoading(true);
    try {
      const csv = await fetchCSV(SHEET_URLS.empenhosNF);
      setEmpenhos(toEmpenhosNF(csv));
    } catch { /* offline */ }
    setLoading(false);
  }

  async function carregarNeIdentificadores() {
    const { data, error } = await supabase
      .from("siloms_ne_identificadores")
      .select("*")
      .limit(2000);
    if (error) console.error("[NE Idents]", error.message);
    if (data) setNeIdents(data as NeIdent[]);
  }

  useEffect(() => {
    carregarPlanilha();
    carregarNeIdentificadores();
    carregarSolicitacoes();
  }, []); // eslint-disable-line

  // (Resultado Robô removido — robô salva direto no Supabase)

  // ── Derived data ─────────────────────────────────────────────────────────
  const seMap = useMemo(
    () => new Map(solicitacoes.map(s => [s.solicitacao.toUpperCase(), s])),
    [solicitacoes]
  );

  const rows = useMemo(() => {
    const neIdentsMap = new Map(neIdents.map(r => [r.ne_siafi.toUpperCase(), r]));

    // Primeira emissão de cada NE SIAFI (reforços não entram na média)
    const firstEmissaoMap = new Map<string, Date>();
    for (const ne of empenhos) {
      const key = ne.nota_empenho.toUpperCase();
      const d = ne.data ? parseDate(ne.data) : null;
      if (!d) continue;
      const existing = firstEmissaoMap.get(key);
      if (!existing || d < existing) firstEmissaoMap.set(key, d);
    }

    return empenhos.map(ne => {
      const ident = neIdentsMap.get(ne.nota_empenho.toUpperCase());

      // SE (coluna): usa o campo extraído da planilha (26SXXXX/26MXXXX da descrição)
      // Se não houver código de SE, mostra a descrição completa
      const seDisplay = ne.solicitacao?.trim()
        ? ne.solicitacao.trim()
        : ne.descricao?.trim() || "";

      // Para calcular Dias, busca SE na tabela de solicitações
      const solKey = (ne.solicitacao || ident?.solicitacao || "").toUpperCase();
      const se     = solKey ? seMap.get(solKey) : undefined;

      let dias: number | null = null;
      if (se?.dt_solicitacao) {
        const primeiraEmissao = firstEmissaoMap.get(ne.nota_empenho.toUpperCase());
        const dtSol           = parseDate(se.dt_solicitacao);
        if (primeiraEmissao && dtSol) {
          dias = Math.round((primeiraEmissao.getTime() - dtSol.getTime()) / 86400000);
        }
      }

      const ug_cred = UG_CODE_MAP[ne.ugcred_code] ?? ne.ugr ?? ne.ugcred_code ?? "";

      return {
        ne,
        nota_empenho:     ne.nota_empenho,
        data:             ne.data,
        valor:            ne.valor,
        identificador:    ident?.identificador ?? "",
        solicitacao:      seDisplay,
        subprocesso:      ident?.subprocesso  ?? null,
        perfil_atual:     ident?.perfil_atual ?? null,
        ug_cred,
        dias,
        se_excluir_media: se?.excluir_media   ?? false,
        se_sol:           se ?? null,
      };
    });
  }, [empenhos, neIdents, seMap]);

  const ugCredsDisponiveis = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows)        { if (r.ug_cred) set.add(r.ug_cred); }
    for (const s of solicitacoes){ if (s.ug_cred) set.add(s.ug_cred); }
    return Array.from(set).sort();
  }, [rows, solicitacoes]);

  const planilhaNEs = useMemo(
    () => new Set(empenhos.map(e => e.nota_empenho.toUpperCase())),
    [empenhos]
  );

  const filtrado = useMemo(() => {
    const q = busca.trim().toUpperCase();
    return rows.filter(r => {
      if (semSubproc && r.subprocesso) return false;
      if (pendAssinatura && !isPendenteOD(r.ne)) return false;
      if (perfilFiltro === "__ACI__") {
        if (isPerfilRelevante(r.perfil_atual)) return false;
      } else if (perfilFiltro && (r.perfil_atual ?? "") !== perfilFiltro) return false;
      if (ugCredFiltro && (r.ug_cred || "") !== ugCredFiltro) return false;
      if (responsavelFiltro && (r.se_sol?.responsavel ?? "") !== responsavelFiltro) return false;
      if (!q) return true;
      return (
        r.nota_empenho.toUpperCase().includes(q) ||
        r.identificador.toUpperCase().includes(q) ||
        (r.solicitacao    ?? "").toUpperCase().includes(q) ||
        (r.subprocesso    ?? "").toUpperCase().includes(q) ||
        (r.ne.pag         ?? "").toUpperCase().includes(q) ||
        (r.ne.cnpj        ?? "").toUpperCase().includes(q) ||
        (r.ne.nome_fantasia ?? "").toUpperCase().includes(q)
      );
    });
  }, [rows, busca, semSubproc, pendAssinatura, perfilFiltro, ugCredFiltro, responsavelFiltro]);

  const totalValor = useMemo(
    () => filtrado.reduce((s, r) => s + (r.valor ?? 0), 0),
    [filtrado]
  );

  const semSubprocCount = useMemo(
    () => rows.filter(r => !r.subprocesso).length,
    [rows]
  );

  const pendAssinaturaCount = useMemo(
    () => rows.filter(r => isPendenteOD(r.ne)).length,
    [rows]
  );

  const perfisDisponiveis = useMemo(() => {
    const set = new Set(neIdents.map(n => n.perfil_atual).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [neIdents]);

  const mediaDias = useMemo(() => {
    // Deduplica por NE SIAFI: cada NE conta uma vez na média (reforços usam a mesma data)
    const seen = new Set<string>();
    const validos = rows.filter(r => {
      if (r.dias === null || r.dias < 0 || r.dias > 10 || r.se_excluir_media) return false;
      const key = r.nota_empenho.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!validos.length) return null;
    const soma = validos.reduce((s, r) => s + (r.dias ?? 0), 0);
    return { media: Math.round(soma / validos.length), n: validos.length };
  }, [rows]);

  const gerarRelatorio = useCallback(() => {
    const dataHoje = new Date().toLocaleDateString("pt-BR");
    const filtros: string[] = [];
    if (semSubproc)         filtros.push("Sem subprocesso");
    if (ugCredFiltro)       filtros.push(`UG: ${ugCredFiltro}`);
    if (perfilFiltro === "__ACI__") filtros.push("Perfil: Ação de CI pendente");
    else if (perfilFiltro)  filtros.push(`Perfil: ${perfilFiltro}`);
    if (responsavelFiltro)  filtros.push(`Resp.: ${responsavelFiltro}`);
    if (busca.trim())       filtros.push(`Busca: "${busca.trim()}"`);

    const totalValorFiltrado = filtrado.reduce((s, r) => s + (r.valor ?? 0), 0);

    const linhas = filtrado.map(r => `
      <tr>
        <td class="mono">${r.nota_empenho}</td>
        <td>${r.data || "–"}</td>
        <td class="num">${fmtValor(r.valor)}</td>
        <td>${r.ug_cred || "–"}</td>
        <td>${r.identificador || "–"}</td>
        <td>${r.solicitacao || "–"}</td>
        <td>${r.subprocesso || "–"}</td>
        <td class="num">${r.dias !== null ? r.dias : "–"}</td>
        <td>${r.perfil_atual || "–"}</td>
        <td>${statusAssinaturaOD(r.ne) || "✅ Assinado"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Relatório de NEs SIAFI — GAP-MN</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #1e293b; padding: 20px; }
    h1 { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px; }
    .subtitle { font-size: 10px; color: #64748b; margin-bottom: 12px; }
    .filtros { font-size: 9px; color: #475569; margin-bottom: 10px; background: #f1f5f9; padding: 5px 8px; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1e3a5f; color: #fff; font-size: 9px; font-weight: 600; text-transform: uppercase;
         letter-spacing: .04em; padding: 5px 6px; text-align: left; white-space: nowrap; }
    td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .mono { font-family: "Courier New", monospace; font-weight: 600; color: #0369a1; font-size: 9.5px; }
    .num  { text-align: right; white-space: nowrap; }
    .footer { margin-top: 14px; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
    .total-row td { font-weight: 700; background: #eff6ff; border-top: 2px solid #bfdbfe; }
    @media print {
      body { padding: 10mm; font-size: 9px; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>Relatório de Notas de Empenho SIAFI</h1>
  <div class="subtitle">GAP-MN · Seção de Execução Orçamentária · Emitido em ${dataHoje}</div>
  ${filtros.length ? `<div class="filtros">Filtros aplicados: ${filtros.join(" · ")}</div>` : ""}
  <table>
    <thead>
      <tr>
        <th>NE SIAFI</th>
        <th>Dt. Emissão</th>
        <th style="text-align:right">Valor</th>
        <th>UG Cred</th>
        <th>Identificador</th>
        <th>SE</th>
        <th>Subprocesso</th>
        <th style="text-align:right">Dias</th>
        <th>Perfil Atual</th>
        <th>Sit. OD</th>
      </tr>
    </thead>
    <tbody>
      ${linhas}
      <tr class="total-row">
        <td colspan="2">Total (${filtrado.length} NEs)</td>
        <td class="num">${fmtValor(totalValorFiltrado)}</td>
        <td colspan="7"></td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    <span>GAP-MN — Sistema de Gestão de Processos</span>
    <span>${filtrado.length} nota(s) · ${dataHoje}</span>
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=1100,height=750");
    if (!win) { alert("Permita pop-ups para gerar o relatório."); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }, [filtrado, semSubproc, pendAssinatura, ugCredFiltro, perfilFiltro, responsavelFiltro, busca]);

  // Pendentes: "Assinada OD UGCred" (ativas) + empenho_realizado=true (empenhadas, aguardando NE)
  // + emissão entries (nr_documento set, sem status = aguardando emissão de NE no SIAFI)
  // Saem dos pendentes quando aparecem na planilha (ne.solicitacao match)
  const sePendentes = useMemo(() => {
    const planilhaSols = new Set(
      empenhos.map(e => (e.solicitacao ?? "").toUpperCase()).filter(Boolean)
    );
    // Subprocessos já vinculados a alguma NE emitida
    const planilhaSubprocs = new Set<string>();
    for (const n of neIdents) {
      if (n.subprocesso) {
        n.subprocesso.split(/,\s*/).filter(Boolean).forEach(s => planilhaSubprocs.add(s.trim()));
      }
    }
    return solicitacoes.filter(s => {
      const sol = s.solicitacao.toUpperCase();
      if (planilhaSols.has(sol)) return false;      // NE já emitida → sai
      if (s.nr_documento && planilhaSubprocs.has(s.nr_documento.trim())) return false; // subprocesso já na NE → sai
      if (!!s.status) return true;                    // Qualquer status = veio do leitor SE, já assinada
      if (s.empenho_realizado) return true;          // Empenhada, aguardando NE na planilha
      if (!s.status && !!s.nr_documento) return true; // Emissão SILOMS: subprocesso registrado, sem SE/status
      return false;
    });
  }, [solicitacoes, empenhos, neIdents]);

  const sePendentesFiltradas = useMemo(() => {
    if (!responsavelFiltro && !busca) return sePendentes;
    const q = busca.trim().toUpperCase();
    return sePendentes.filter(s => {
      if (responsavelFiltro && (s.responsavel ?? "") !== responsavelFiltro) return false;
      if (q && !s.solicitacao.toUpperCase().includes(q) && !(s.nr_documento ?? "").toUpperCase().includes(q)) return false;
      return true;
    });
  }, [sePendentes, responsavelFiltro, busca]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-3 rounded-2xl transition-colors${darkMode ? " empenhos-dark p-3" : ""}`}>

      {/* ── Modal Excluir da Média ── */}
      {showExcluirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => { setShowExcluirModal(null); setJustificativaExcluir(""); }}>
          <div className="bg-white rounded-2xl shadow-2xl border max-w-sm w-full mx-4 p-5 space-y-3"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-sm">⛔ Excluir SE da média</span>
              <button onClick={() => { setShowExcluirModal(null); setJustificativaExcluir(""); }}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <p className="text-xs text-slate-500">
              A SE <strong className="font-mono text-slate-700">{showExcluirModal}</strong> não contará
              no cálculo da média de tempo. Informe o motivo:
            </p>
            <textarea
              rows={3}
              value={justificativaExcluir}
              onChange={e => setJustificativaExcluir(e.target.value)}
              placeholder="Ex: Atraso por problema técnico no SIAFI..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-200 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowExcluirModal(null); setJustificativaExcluir(""); }}
                className="rounded-xl border border-slate-200 px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                disabled={!justificativaExcluir.trim()}
                onClick={() => {
                  toggleExcluirMedia(showExcluirModal!, true, justificativaExcluir.trim());
                  setShowExcluirModal(null); setJustificativaExcluir("");
                }}
                className="rounded-xl bg-red-600 text-white px-4 py-1.5 text-xs font-semibold disabled:opacity-40 hover:bg-red-700">
                Confirmar exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Colar SE ── */}
      {showColarSeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowColarSeModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border max-w-2xl w-full mx-4 p-5 space-y-3 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-sm">📥 Solicitações de Empenho RECEBIDAS</span>
              <button onClick={() => { setShowColarSeModal(false); setColarSeTexto(""); setColarSeParsed([]); setColarSeMsg(null); }}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {/* Sub-abas */}
            <div className="flex border-b border-slate-200">
              {([["colar", "📋 Colar tabela"], ["robo", "⚙️ Robô SE"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setColarSeTab(key)}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${colarSeTab === key ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Aba: Colar tabela manualmente */}
            {colarSeTab === "colar" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  No SILOMS (<em>Gerenciamento de Solicitações de Empenho → Recebidas</em>), aumente o "Exibir" para
                  mostrar todos os registros, selecione a tabela inteira, copie e cole abaixo.
                  O app extrai <strong>Solicitação</strong>, <strong>UG Cred</strong> e <strong>Dt Solicitação</strong>.
                </p>
                <textarea
                  rows={6}
                  value={colarSeTexto}
                  onChange={e => { setColarSeTexto(e.target.value); setColarSeParsed([]); setColarSeMsg(null); }}
                  placeholder={"Solicitação\tUG Exec\tUG Cred\t...\tDt Solicitação\t...\n26S0447\tGAP-MN\tGAP-MN\t...\t13/04/2026\t..."}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-200 resize-y"
                />
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => { const p = parseSETable(colarSeTexto); setColarSeParsed(p); setColarSeMsg(p.length ? null : "⚠️ Nenhuma SE encontrada. Verifique se o cabeçalho está incluído."); }}
                    disabled={!colarSeTexto.trim()}
                    className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-40">
                    🔍 Analisar
                  </button>
                  {colarSeParsed.length > 0 && (
                    <>
                      <button onClick={() => salvarColarSE("novas")} disabled={colarSeSalvando}
                        className="rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                        {colarSeSalvando ? "Salvando..." : `➕ Adicionar novas (${colarSeParsed.filter(r => !solicitacoes.find(s => s.solicitacao.toUpperCase() === r.solicitacao.toUpperCase())).length})`}
                      </button>
                      <button onClick={() => {
                        if (confirm(`⚠️ ATENÇÃO\n\nIsso apagará TODAS as ${solicitacoes.length} SEs registradas e reimportará ${colarSeParsed.length} SEs.\n\nResponsáveis e exclusões da média serão perdidos.\n\nConfirmar?`))
                          salvarColarSE("substituir");
                      }} disabled={colarSeSalvando}
                        className="rounded-xl border border-red-300 bg-red-50 px-4 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50">
                        🔄 Substituir tudo ({colarSeParsed.length})
                      </button>
                    </>
                  )}
                </div>
                {colarSeMsg && (
                  <div className={`text-xs px-3 py-2 rounded-lg ${colarSeMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {colarSeMsg}
                  </div>
                )}
                {colarSeParsed.length > 0 && (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Solicitação</th>
                          <th className="px-3 py-2 text-left font-semibold">UG Cred</th>
                          <th className="px-3 py-2 text-left font-semibold">Dt Solicitação</th>
                          <th className="px-2 py-2 text-center font-semibold text-[10px] text-slate-400">Nova?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colarSeParsed.map((r, i) => {
                          const jaExiste = solicitacoes.some(s => s.solicitacao.toUpperCase() === r.solicitacao.toUpperCase());
                          return (
                            <tr key={i} className={`border-t border-slate-100 ${jaExiste ? "opacity-50" : "hover:bg-slate-50"}`}>
                              <td className="px-3 py-1.5 font-mono text-sky-700">{r.solicitacao}</td>
                              <td className="px-3 py-1.5 text-slate-600">{r.ug_cred || "–"}</td>
                              <td className="px-3 py-1.5 text-slate-600">{fmtDate(r.dt_solicitacao)}</td>
                              <td className="px-2 py-1.5 text-center">{jaExiste ? <span className="text-slate-300 text-[10px]">já existe</span> : <span className="text-emerald-600 font-bold">✓</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Aba: Robô SE (bookmarklet) */}
            {colarSeTab === "robo" && (
              <div className="space-y-3">
                <div className="rounded-xl border-2 border-sky-400 bg-sky-50 p-4 space-y-3">
                  <p className="text-[11px] font-bold text-sky-800">✅ SE Leitor — Favorito automático</p>
                  <ol className="text-[11px] text-sky-700 space-y-1.5 list-decimal list-inside">
                    <li>Arraste o botão abaixo para a barra de favoritos:</li>
                  </ol>
                  <div ref={seLeitorBookmarkRef}
                    className="flex items-center gap-3 rounded-lg bg-white border border-sky-200 px-3 py-2" />
                  <ol start={2} className="text-[11px] text-sky-700 space-y-1.5 list-decimal list-inside">
                    <li>No SILOMS, acesse <strong>Gerenciamento de Solicitações → Recebidas</strong>, aplique filtros e pesquise.</li>
                    <li>Aumente "Exibir" para o máximo disponível.</li>
                    <li>Com os resultados visíveis, clique <strong>📋 SE Leitor</strong> na barra de favoritos.</li>
                    <li>O script lê a tabela e salva apenas as SEs novas no Supabase.</li>
                  </ol>
                  <div className="bg-sky-100 rounded-lg px-3 py-1.5 text-[10px] text-sky-700">
                    Não conseguiu arrastar?{" "}
                    <button
                      onClick={() => { navigator.clipboard.writeText("javascript:" + SILOMS_SE_LEITOR_BOOKMARKLET).then(() => { setCopiedSeLeitor(true); setTimeout(() => setCopiedSeLeitor(false), 2500); }); }}
                      className="underline font-semibold">
                      {copiedSeLeitor ? "✅ Copiado!" : "Copiar código"}
                    </button>
                    {" "}→ crie favorito manualmente e cole no campo URL.
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Modal unificado: Subprocessos (Colar + Robô) ── */}
      {showSubprocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowSubprocModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border max-w-2xl w-full mx-4 p-5 space-y-3 max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 text-sm">📋 Subprocessos</span>
              <button onClick={() => setShowSubprocModal(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>

            {/* Sub-abas */}
            <div className="flex border-b border-slate-200">
              {([["colar", "📋 Colar Subprocessos"], ["robo", "⚙️ Robô Subprocessos"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setSubprocTab(key)}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${subprocTab === key ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Aba: Colar */}
            {subprocTab === "colar" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500">
                  No SILOMS (<em>Documentos → Documentos na Unidade</em>), pesquise os documentos,
                  selecione a tabela de resultados, copie e cole abaixo.
                  O app extrai Nr. Documento e Perfil Unidade Atual de cada NE.
                </p>
                <textarea
                  rows={6}
                  value={colarTexto}
                  onChange={e => { setColarTexto(e.target.value); setColarParsed([]); setColarMsg(null); }}
                  placeholder={"Nr. Documento\tNome\tPAG\t...\n\t149243\tSOLICITAÇÃO DE EMPENHO ... 2026NE000559\t..."}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-teal-200 resize-y"
                />
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => { const p = parseSilomsTable(colarTexto); setColarParsed(p); setColarMsg(p.length ? null : "⚠️ Nenhuma NE encontrada. Verifique se o cabeçalho está incluído."); }}
                    disabled={!colarTexto.trim()}
                    className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-40">
                    🔍 Analisar
                  </button>
                  {colarParsed.length > 0 && (
                    <button onClick={salvarColar} disabled={colarSalvando}
                      className="rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                      {colarSalvando ? "Salvando..." : `💾 Salvar ${colarParsed.length} registro(s)`}
                    </button>
                  )}
                </div>
                {colarMsg && (
                  <div className={`text-xs px-3 py-2 rounded-lg ${colarMsg.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                    {colarMsg}
                  </div>
                )}
                {colarParsed.length > 0 && (
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">NE SIAFI</th>
                          <th className="px-3 py-2 text-left font-semibold">Nr. Documento</th>
                          <th className="px-3 py-2 text-left font-semibold">SE extraída</th>
                          <th className="px-3 py-2 text-left font-semibold">Perfil Unidade Atual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colarParsed.map((r, i) => (
                          <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-1.5 font-mono text-sky-700">{r.ne_siafi}</td>
                            <td className="px-3 py-1.5 font-mono font-semibold text-slate-800">{r.subprocesso}</td>
                            <td className="px-3 py-1.5 font-mono text-indigo-600">{r.solicitacao || <span className="text-slate-300">–</span>}</td>
                            <td className="px-3 py-1.5 text-slate-600">{r.perfil_atual || <span className="text-slate-300">–</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Aba: Robô Subprocessos */}
            {subprocTab === "robo" && (
              <div className="space-y-3">
                <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 space-y-3">
                  <p className="text-[11px] font-bold text-emerald-800">✅ Favorito "SILOMS Leitor" (recomendado)</p>
                  <ol className="text-[11px] text-emerald-700 space-y-1.5 list-decimal list-inside">
                    <li>Arraste o botão abaixo para a barra de favoritos:</li>
                  </ol>
                  <div ref={leitorBookmarkRef}
                    className="flex items-center gap-3 rounded-lg bg-white border border-emerald-300 px-3 py-2" />
                  <ol start={2} className="text-[11px] text-emerald-700 space-y-1.5 list-decimal list-inside">
                    <li>No SILOMS, vá em <strong>Documentos → Documentos na Unidade</strong>, aplique filtros e pesquise.</li>
                    <li>Com a tabela visível, clique <strong>📋 SILOMS Leitor</strong> nos favoritos.</li>
                    <li>O script salva direto no Supabase. Depois clique <strong>Atualizar</strong> aqui.</li>
                  </ol>
                  <div className="bg-emerald-100 rounded-lg px-3 py-1.5 text-[10px] text-emerald-700">
                    Não conseguiu arrastar?{" "}
                    <button onClick={() => { navigator.clipboard.writeText("javascript:" + SILOMS_LEITOR_BOOKMARKLET).then(() => { setCopiedLeitor(true); setTimeout(() => setCopiedLeitor(false), 2500); }); }}
                      className="underline font-semibold">
                      {copiedLeitor ? "✅ Copiado!" : "Copiar código"}
                    </button>
                    {" "}→ crie favorito manualmente e cole no campo URL.
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-slate-600">Tampermonkey (preenche formulário automaticamente)</p>
                  <ol className="text-[11px] text-slate-500 space-y-1 list-decimal list-inside">
                    <li>Instale <strong>Tampermonkey</strong> no Firefox.</li>
                    <li>Crie novo script e cole o conteúdo de <code className="bg-slate-100 px-1 rounded font-mono text-[10px]">siloms-bot/gapmn-siloms.user.js</code>.</li>
                    <li>No SILOMS, acesse <em>Documentos na Unidade</em> — o painel azul aparece.</li>
                    <li>Clique <strong>"Iniciar Robô"</strong> e aguarde. VPN deve estar ativa.</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">
              NEs SIAFI
              {rows.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {filtrado.length} / {rows.length}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">
              Planilha Google Sheets
              {loading && <span className="ml-2 text-slate-400">↻ carregando...</span>}
            </div>
          </div>

          {/* Colar SE (Solicitações de Empenho) */}
          {canEdit && (
            <button onClick={() => { setShowColarSeModal(true); setColarSeTexto(""); setColarSeParsed([]); setColarSeMsg(null); setColarSeTab("colar"); }}
              className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100">
              📥 Colar SE
            </button>
          )}

          {/* Gerar Relatório PDF */}
          <button
            onClick={gerarRelatorio}
            disabled={filtrado.length === 0}
            title="Gerar relatório PDF das NEs filtradas"
            className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            🖨️ Gerar Relatório
          </button>

          {/* Colar/Robô Subprocessos (modal unificado) */}
          {canEdit && (
            <button onClick={() => { setShowSubprocModal(true); setSubprocTab("colar"); setColarTexto(""); setColarParsed([]); setColarMsg(null); }}
              className="rounded-xl border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100">
              📋 Colar Subprocessos
            </button>
          )}

          {canSync && (
            <button onClick={() => { carregarPlanilha(); carregarNeIdentificadores(); carregarSolicitacoes(); }} disabled={loading}
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
              <span className={loading ? "animate-spin inline-block" : ""}>↻</span> Atualizar
            </button>
          )}

          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar..."
            className="rounded-xl border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-200 w-36" />

          <button
            onClick={() => setDarkMode(d => !d)}
            title={darkMode ? "Modo claro" : "Modo escuro"}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 ml-auto"
          >
            {darkMode ? "☀️ Claro" : "🌙 Escuro"}
          </button>
        </div>

        {/* Filtros */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setSemSubproc(v => !v)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${semSubproc ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
            {semSubproc ? "● " : ""}Sem subprocesso
            {semSubprocCount > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${semSubproc ? "bg-amber-200 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
                {semSubprocCount}
              </span>
            )}
          </button>

          <button onClick={() => setPendAssinatura(v => !v)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${pendAssinatura ? "border-rose-400 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
            {pendAssinatura ? "● " : ""}Pendente de Assinatura OD
            {pendAssinaturaCount > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${pendAssinatura ? "bg-rose-200 text-rose-800" : "bg-slate-100 text-slate-500"}`}>
                {pendAssinaturaCount}
              </span>
            )}
          </button>

          {/* Filtro por UG Cred */}
          {ugCredsDisponiveis.length > 0 && (
            <select value={ugCredFiltro} onChange={e => setUgCredFiltro(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200">
              <option value="">Todas as UGs</option>
              {ugCredsDisponiveis.map(ug => (
                <option key={ug} value={ug}>{ug}</option>
              ))}
            </select>
          )}

          {/* Filtro por Perfil Atual */}
          <select value={perfilFiltro} onChange={e => setPerfilFiltro(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200">
            <option value="">Todos os perfis</option>
            {PERFIS_RELEVANTES.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
            <option value="__ACI__">ACI (outros)</option>
          </select>

          {/* Filtro por Responsável */}
          <select value={responsavelFiltro} onChange={e => setResponsavelFiltro(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200">
            <option value="">Todos os resp.</option>
            <option value="3S ANNE">3S ANNE</option>
            <option value="3S ELAINE">3S ELAINE</option>
            <option value="2T BRUNO">2T BRUNO</option>
          </select>
        </div>


      </Card>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-600">
            📄 Notas de Empenho ({new Set(filtrado.map(r => r.nota_empenho)).size})
          </span>
          <button
            onClick={() => setShowNEsTable(v => !v)}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            {showNEsTable ? "▲ Ocultar" : "▼ Mostrar"}
          </button>
        </div>
        {showNEsTable && <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
          <table className="w-full text-xs border-collapse table-fixed" style={{ minWidth: "960px" }}>
            <colgroup>
              <col style={{ width: "18px" }} />
              <col style={{ width: "148px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "108px" }} />
              <col style={{ width: "100px" }} />
              <col style={{ width: "100px" }} />
              <col style={{ width: "100px" }} />
              <col style={{ width: "68px" }} />
              <col style={{ width: "150px" }} />
            </colgroup>
            <thead className="bg-slate-50 text-left sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <th className="px-1 py-2"></th>
                <th className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">NE SIAFI</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Dt. Emissão</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap text-right">Valor</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Identificador</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">SE</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Subprocesso</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap text-center" title="Dias desde a chegada da SE até emissão da NE">Dias</th>
                <th className="px-2 py-2 font-semibold text-slate-600 whitespace-nowrap">Perfil Atual</th>
              </tr>
            </thead>
            <tbody>
              {filtrado.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                    {rows.length === 0 ? "Carregando NEs da planilha..." : "Sem resultados para os filtros aplicados."}
                  </td>
                </tr>
              ) : filtrado.map((row, i) => {
                const isExpanded = expandedNE === row.nota_empenho;
                const temSubproc = !!row.subprocesso;
                return (
                  <>
                    <tr key={`${row.nota_empenho}||${i}`}
                      className={`border-b transition-colors cursor-pointer ${isExpanded ? "bg-sky-50" : "hover:bg-slate-50/70"}`}
                      onClick={() => setExpandedNE(prev => prev === row.nota_empenho ? null : row.nota_empenho)}>

                      {/* indicador subprocesso */}
                      <td className="px-1 py-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${temSubproc ? "bg-emerald-400" : "bg-slate-200"}`}
                          title={temSubproc ? `Subprocesso: ${row.subprocesso}` : "Sem subprocesso"} />
                      </td>

                      {/* NE SIAFI */}
                      <td className="px-3 py-1.5 font-mono font-semibold text-sky-700 text-[11px] whitespace-nowrap">
                        {row.nota_empenho}
                        <span className="ml-1 text-slate-300 text-[9px]">{isExpanded ? "▲" : "▼"}</span>
                      </td>

                      {/* Dt. Emissão */}
                      <td className="px-2 py-1.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {row.data || <span className="text-slate-300">–</span>}
                      </td>

                      {/* Valor */}
                      <td className="px-2 py-1.5 font-mono text-slate-700 text-[11px] whitespace-nowrap text-right">
                        {fmtValor(row.valor)}
                      </td>

                      {/* Identificador */}
                      <td className="px-2 py-1.5 font-mono text-indigo-600 text-[11px] whitespace-nowrap overflow-hidden">
                        {row.identificador || <span className="text-slate-300">–</span>}
                      </td>

                      {/* SE */}
                      <td className="px-2 py-1.5 font-mono text-slate-600 text-[11px] break-words leading-snug">
                        {row.solicitacao || <span className="text-slate-300">–</span>}
                      </td>

                      {/* Subprocesso */}
                      <td className="px-2 py-1.5 font-mono text-[11px] whitespace-nowrap overflow-hidden">
                        {row.subprocesso
                          ? <span className="text-emerald-700 font-semibold">{row.subprocesso}</span>
                          : row.subprocesso === ""
                            ? <span className="text-slate-300 italic text-[10px]">não encontrado</span>
                            : <span className="text-slate-300">–</span>}
                      </td>

                      {/* Dias (SE → NE) */}
                      <td className="px-2 py-1.5 text-center">
                        {row.dias !== null ? (
                          <button
                            onClick={e => { e.stopPropagation(); if (row.se_excluir_media) { toggleExcluirMedia(row.solicitacao, false); } else { setShowExcluirModal(row.solicitacao); } }}
                            title={row.se_excluir_media ? `Excluída da média. Clique para reincluir.` : `${row.dias} dias — clique para excluir da média`}
                            className={`inline-flex items-center justify-center rounded-lg px-2 py-0.5 font-mono text-[11px] font-semibold border transition-colors ${
                              row.se_excluir_media
                                ? "line-through text-slate-400 border-slate-200 bg-slate-50"
                                : row.dias <= 5
                                  ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                  : row.dias <= 10
                                    ? "text-yellow-700 bg-yellow-50 border-yellow-200"
                                    : row.dias <= 20
                                      ? "text-orange-700 bg-orange-50 border-orange-200"
                                      : "text-red-700 bg-red-50 border-red-200"
                            }`}>
                            {row.dias}d
                          </button>
                        ) : (
                          <span className="text-slate-300 text-[11px]">–</span>
                        )}
                      </td>

                      {/* Perfil Atual */}
                      <td className="px-2 py-1.5 text-[11px] overflow-hidden" title={row.perfil_atual ?? ""}>
                        {row.perfil_atual
                          ? <span className="text-violet-700 truncate block max-w-[140px]">{row.perfil_atual}</span>
                          : <span className="text-slate-300">–</span>}
                      </td>
                    </tr>

                    {/* Linha expandida — detalhes da NE */}
                    {isExpanded && (
                      <tr key={`exp-${row.nota_empenho}`} className="bg-sky-50 border-b">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                            {row.ne.descricao && (
                              <div className="col-span-2 sm:col-span-3 bg-white rounded-lg border border-sky-100 px-3 py-2 text-slate-600 leading-relaxed break-words">
                                {row.ne.descricao}
                              </div>
                            )}

                            {/* PAG / CNPJ / Nome Fantasia — destaque em bloco próprio */}
                            {(row.ne.pag || row.ne.cnpj || row.ne.nome_fantasia) && (
                              <div className="col-span-2 sm:col-span-3 grid grid-cols-3 gap-2">
                                {row.ne.pag && (
                                  <div className="bg-amber-50 rounded-lg border border-amber-200 px-3 py-1.5">
                                    <p className="text-[9px] font-semibold uppercase text-amber-500 mb-0.5">PAG</p>
                                    <p className="font-mono text-amber-800 text-[11px] break-all">{row.ne.pag}</p>
                                  </div>
                                )}
                                {row.ne.cnpj && (
                                  <div className="bg-amber-50 rounded-lg border border-amber-200 px-3 py-1.5">
                                    <p className="text-[9px] font-semibold uppercase text-amber-500 mb-0.5">CNPJ</p>
                                    <p className="font-mono text-amber-800 text-[11px]">{row.ne.cnpj}</p>
                                  </div>
                                )}
                                {row.ne.nome_fantasia && (
                                  <div className="bg-amber-50 rounded-lg border border-amber-200 px-3 py-1.5">
                                    <p className="text-[9px] font-semibold uppercase text-amber-500 mb-0.5">Nome Fantasia</p>
                                    <p className="text-amber-800 text-[11px]">{row.ne.nome_fantasia}</p>
                                  </div>
                                )}
                                {row.ne.assinatura && (() => {
                                  const sitOD = statusAssinaturaOD(row.ne);
                                  const isSemInfo = row.ne.assinatura.toUpperCase() === "SEM INFORMACAO";
                                  const isRatif   = !isSemInfo && sitOD !== "";
                                  const bg    = isSemInfo ? "bg-rose-50 border-rose-200" : isRatif ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200";
                                  const label = isSemInfo ? "text-rose-500" : isRatif ? "text-amber-600" : "text-emerald-600";
                                  const body  = isSemInfo ? "text-rose-700" : isRatif ? "text-amber-800" : "text-emerald-800";
                                  const text  = isSemInfo ? "⏳ Pendente de Assinatura OD"
                                              : isRatif   ? `⚠️ Pendente de Ratificação OD — ${row.ne.assinatura}`
                                              : `✅ ${row.ne.assinatura}`;
                                  return (
                                    <div className={`rounded-lg border px-3 py-1.5 ${bg}`}>
                                      <p className={`text-[9px] font-semibold uppercase mb-0.5 ${label}`}>Assinatura OD</p>
                                      <p className={`text-[11px] font-semibold ${body}`}>{text}</p>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}

                            {[
                              ["UGCred",     row.ne.ugcred_code],
                              ["Natureza",   row.ne.natureza],
                              ["PI",         row.ne.pi],
                              ["PI Desc",    row.ne.pi_desc],
                              ["Solicitação (planilha)", row.ne.solicitacao],
                              ["Dt Solicitação SE", row.se_sol?.dt_solicitacao ? fmtDate(row.se_sol.dt_solicitacao) : null],
                              ["Responsável SE", row.se_sol?.responsavel ?? null],
                              ["Excluída da média", row.se_excluir_media ? (row.se_sol?.justificativa_exclusao ?? "Sim") : null],
                            ].filter(([, v]) => v).map(([l, v]) => (
                              <div key={l as string} className="bg-white rounded-lg border border-sky-100 px-3 py-1.5">
                                <p className="text-[9px] font-semibold uppercase text-slate-400 mb-0.5">{l}</p>
                                <p className="font-mono text-slate-700">{v}</p>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 sticky bottom-0">
                <td colSpan={3} className="px-3 py-2 text-xs font-semibold text-slate-500 text-right">Total</td>
                <td className="px-2 py-2 text-right font-mono font-bold text-slate-800 whitespace-nowrap">
                  {fmtValor(totalValor)}
                </td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>}
      </div>

      {/* ── Solicitações Pendentes ── */}
      {sePendentesFiltradas.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                📋 Solicitações Pendentes
                <span className="rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5">
                  {sePendentesFiltradas.length}{sePendentesFiltradas.length < sePendentes.length ? `/${sePendentes.length}` : ''} pendentes
                </span>
              </div>
              <div className="text-xs text-slate-500">
                Solicitações aguardando emissão de NE SIAFI
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-semibold">Solicitação</th>
                  <th className="px-3 py-2 text-left font-semibold">UG Cred</th>
                  <th className="px-3 py-2 text-left font-semibold">Dt Solicitação</th>
                  <th className="px-3 py-2 text-left font-semibold">Responsável</th>
                  <th className="px-3 py-2 text-center font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Subprocesso</th>
                  <th className="px-3 py-2 text-center font-semibold">Emitido</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sePendentesFiltradas.map(s => {
                  const isEmpenhada = s.empenho_realizado;
                  return (
                    <tr key={s.solicitacao}
                      className={`border-t border-slate-100 transition-colors ${isEmpenhada ? "bg-green-50/60" : "hover:bg-slate-50"}`}>
                      <td className={`px-3 py-1.5 font-mono font-semibold ${isEmpenhada ? "text-slate-400" : "text-sky-700"}`}>
                        {s.solicitacao}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{s.ug_cred || "–"}</td>
                      <td className="px-3 py-1.5 text-slate-600">{fmtDate(s.dt_solicitacao)}</td>
                      <td className="px-3 py-1.5">
                        {canEditPendentes && !isEmpenhada ? (
                          <select
                            value={s.responsavel ?? ""}
                            onChange={e => atualizarResponsavel(s.solicitacao, e.target.value)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200">
                            <option value="">— sem responsável —</option>
                            <option value="3S ANNE">3S ANNE</option>
                            <option value="3S ELAINE">3S ELAINE</option>
                            <option value="2T BRUNO">2T BRUNO</option>
                          </select>
                        ) : (
                          <span className={s.responsavel ? "text-slate-700" : "text-slate-300"}>{s.responsavel || "–"}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {isEmpenhada
                          ? <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-semibold bg-green-100 border border-green-300 text-green-700">✅ Empenhada — aguardando NE</span>
                          : <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-semibold bg-amber-50 border border-amber-300 text-amber-700">🕐 Assinada OD UGCred</span>
                        }
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-emerald-700 whitespace-normal break-words">
                        {s.nr_documento || <span className="text-slate-300">–</span>}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {canEditPendentes && !isEmpenhada && (
                          <button
                            onClick={() => toggleEmpenhoRealizado(s.solicitacao, true)}
                            title="Marcar como emitida — aguardando atualização da planilha"
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 hover:bg-emerald-100 font-semibold">
                            ✅ Emitido
                          </button>
                        )}
                        {isEmpenhada && canEditPendentes && (
                          <button
                            onClick={() => toggleEmpenhoRealizado(s.solicitacao, false)}
                            title="Desfazer — ainda não emitida"
                            className="rounded-lg border border-slate-200 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-100">
                            ↩
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {canEditPendentes && (
                          <button
                            onClick={() => deletarSolicitacao(s.solicitacao)}
                            title="Remover do banco de dados (cancelada)"
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-600 hover:bg-red-100 font-semibold">
                            🗑
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
