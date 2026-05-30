import { useState, useEffect, useRef, useCallback } from "react";

// ── Config (set via Vercel environment variables) ──────────
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const CLOUD_ENABLED     = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

const GROQ_MODEL        = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'llama-3.2-11b-vision-preview';
const LS_KEY_STORAGE    = 'drcardio-groq-key';
const LS_CACHE          = 'drcardio-cache';
const MAX_API_HISTORY   = 24; // last 12 exchanges kept in context

// ── SHA-256 hash of Groq key → cross-device user ID ───────
async function hashKey(key) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Supabase helpers (no SDK — plain fetch) ────────────────
const sbHeaders = () => ({
  'Content-Type': 'application/json',
  'apikey': SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
});

async function cloudLoad(userId) {
  if (!CLOUD_ENABLED) return null;
  try {
    const res  = await fetch(
      `${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${userId}&select=*`,
      { headers: sbHeaders() }
    );
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch { return null; }
}

async function cloudSave(userId, payload) {
  if (!CLOUD_ENABLED || !userId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/user_data`, {
      method:  'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify({ user_id: userId, ...payload, updated_at: new Date().toISOString() }),
    });
  } catch {}
}

// ── localStorage cache ─────────────────────────────────────
const ls = {
  get: (k) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):null; } catch { return null; } },
  set: (k,v)=> { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k)  => { try { localStorage.removeItem(k); } catch {} },
  getRaw: (k)=>{ try { return localStorage.getItem(k)||''; } catch { return ''; } },
  setRaw: (k,v)=>{ try { localStorage.setItem(k,v); } catch {} },
};

// ── Strip base64 from attachment display records ───────────
function cleanMsgsForStorage(msgs) {
  return msgs.map(m => ({
    ...m,
    attachments: m.attachments?.map(a => ({ type: a.type, name: a.name })),
  }));
}

// ── PDF.js loader ──────────────────────────────────────────
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function extractPdfText(file) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = '';
  for (let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const c    = await page.getTextContent();
    text += c.items.map(x=>x.str).join(' ') + '\n';
  }
  return text.trim();
}
function fileToBase64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(file); });
}

// ── Localisation ───────────────────────────────────────────
const L = {
  en: {
    disclaimer_title:'For Educational Purposes Only',
    disclaimer_body:'Dr. Cardio provides general health information and guidance — not medical diagnosis or treatment. Always consult a qualified doctor before making any health decisions. If you feel unwell, have chest pain, difficulty breathing, or any urgent symptom, please visit your nearest hospital or call ',
    disclaimer_end:' immediately.',
    profile_title:'My Health Profile', profile_sub:'Synced across all your devices',
    profile_tip:'💡 Fill in as much or as little as you like. Dr. Cardio will use this to personalise every conversation — so you never have to repeat your history.',
    profile_save:'Save Health Profile', profile_saved:'Saved ✓', profile_clear:'Clear Profile',
    nudge_title:'Set up your Health Profile', nudge_body:'Save your age, conditions & history so Dr. Cardio remembers you on any device.',
    nudge_cta:'Set up →', my_profile:'My Profile', new_chat:'New chat', reset_key:'Reset key',
    placeholder:'Describe your symptoms or type your report values…',
    attach_tip:'Attach image or PDF report',
    footer:'For educational guidance only · Not a substitute for in-person care · Emergencies: call',
    send_file:'Please review this uploaded report and give me your detailed clinical assessment.',
    today:'Today', yesterday:'Yesterday',
    syncing:'Syncing…', synced:'Synced ✓', local:'Local only',
    quick:[
      {icon:'🩸',label:'High cholesterol',   msg:'I have been told my cholesterol is high. What should I know?'},
      {icon:'🍛',label:'Heart-healthy foods', msg:'What Sri Lankan foods are good for my heart?'},
      {icon:'🧬',label:'Family heart history',msg:'My father had a heart attack at 52. Am I at risk?'},
      {icon:'📋',label:'Lipid panel',         msg:'How do I understand my lipid panel / cholesterol blood test results?'},
    ],
    intro_new:`Introduce yourself with 'Ayubowan and Welcome!' as your opening greeting. Briefly introduce yourself as Dr. Cardio, a Senior Consultant Cardiologist and Lipidologist dedicated to helping Sri Lankans achieve the best heart health. Mention you have cared for patients across Sri Lanka from Colombo to Kandy to Galle. End by asking what brings them to you today. English only. 3-4 warm sentences.`,
    intro_return:`Greet the patient by name if you know it, with 'Ayubowan and Welcome back!' Briefly acknowledge 1-2 known conditions or history from their profile to show you remember them, then ask what brings them today. English only. Warm and personal, 3-4 sentences.`,
    lang_instruction:'',
  },
  si: {
    disclaimer_title:'අධ්‍යාපනික අරමුණු සඳහා පමණි',
    disclaimer_body:'ආචාර්ය කාඩියෝ සාමාන්‍ය සෞඛ්‍ය තොරතුරු ලබා දෙයි — වෛද්‍ය රෝග විනිශ්චයක් නොවේ. පපුවේ වේදනාව හෝ හදිසි රෝග ලක්ෂණ ඇත්නම් ළඟම රෝහලට යන්න හෝ ',
    disclaimer_end:' ට අමතන්න.',
    profile_title:'මගේ සෞඛ්‍ය ප්‍රොෆයිලය', profile_sub:'සියලු උපාංග හරහා සමමුහුර්ත වේ',
    profile_tip:'💡 ඔබට අවශ්‍ය තරම් පුරවන්න. ආචාර්ය කාඩියෝ ඔබව ඕනෑම උපාංගයකින් හඳුනා ගනී.',
    profile_save:'ප්‍රොෆයිලය සුරකින්න', profile_saved:'සුරකිනා ලදී ✓', profile_clear:'ප්‍රොෆයිලය මකන්න',
    nudge_title:'ඔබේ සෞඛ්‍ය ප්‍රොෆයිලය සකසන්න', nudge_body:'ඔබේ රෝග ඉතිහාසය සුරකින්න — ආචාර්ය කාඩියෝ ඕනෑම උපාංගයකින් ඔබව මතක තබා ගනී.',
    nudge_cta:'සකසන්න →', my_profile:'මගේ ප්‍රොෆයිලය', new_chat:'නව සංවාදය', reset_key:'යතුර යළි සකසන්න',
    placeholder:'ඔබේ රෝග ලක්ෂණ හෝ රිපෝට් අගයන් ටයිප් කරන්න…',
    attach_tip:'රූපයක් හෝ PDF රිපෝට්තුවක් අමුණන්න',
    footer:'අධ්‍යාපනික මඟ පෙන්වීම පමණි · හදිසි: ',
    send_file:'කරුණාකර මෙම රිපෝට්තුව සමාලෝචනය කර ඔබේ සම්පූර්ණ සායනික තක්සේරුව ලබා දෙන්න.',
    today:'අද', yesterday:'ඊයේ',
    syncing:'සමමුහුර්ත…', synced:'සමමුහුර්ත ✓', local:'දේශීය',
    quick:[
      {icon:'🩸',label:'කොලෙස්ටරෝල්',       msg:'කොලෙස්ටරෝල් වැඩියි කියලා කිව්වා. මොනවද දැනගන්න ඕනේ?'},
      {icon:'🍛',label:'හදවතට හොඳ ආහාර',    msg:'හදවතට හොඳ ශ්‍රී ලාංකික ආහාර මොනවාද?'},
      {icon:'🧬',label:'පවුලේ හදවත් ඉතිහාසය',msg:'මගේ තාත්තාට 52 දී හදවත් රෝගයක් ආවා. මටත් අවදානමක් තියෙනවාද?'},
      {icon:'📋',label:'ලිපිඩ පරීක්ෂාව',      msg:'ලිපිඩ පැනල් ප්‍රතිඵල තේරුම් ගන්නේ කොහොමද?'},
    ],
    intro_new:`'Ayubowan!' ලෙස ආරම්භ කරන්න. ඔබව ආචාර්ය කාඩියෝ ලෙස හඳුන්වා දෙන්න. සිංහලෙන් පිළිතුරු දෙන්න. 3-4 වාක්‍ය.`,
    intro_return:`'Ayubowan! ආයෙත් දකිනවා!' ලෙස ආරම්භ කරන්න. නම දන්නේ නම් ඇමතීම කරන්න. ප්‍රොෆයිලයෙන් 1-2 දෙයක් සඳහන් කරන්න. සිංහලෙන් පිළිතුරු දෙන්න. 3-4 වාක්‍ය.`,
    lang_instruction:'\n\nIMPORTANT: You MUST respond entirely in Sinhala (සිංහල) script. Every word in Sinhala. Only use English for specific medical terms with no Sinhala equivalent.',
  }
};

// ── System prompt ──────────────────────────────────────────
const BASE_PROMPT = `You are Dr. Cardio — a fully qualified General Physician and Senior Consultant Cardiologist & Lipidologist with 60+ years of clinical experience, with a lifetime of focus on Sri Lankan patients, genetics, culture, food, and lifestyle. You have cared for patients from Colombo to Kandy, Galle to Hambantota.

SRI LANKAN EXPERTISE: South Asian Paradox (heart disease at lower BMI/age than Western patients), visceral adiposity, waist thresholds >80cm women / >90cm men, insulin resistance, 1.5–2x South Asian risk multiplier. Encyclopaedic knowledge of Sri Lankan cuisine — rice, coconut, kiri, parippu, pol sambol, indi appa, appa, pittu, kiribath, kottu, thalapath, thora, hurulla, halmasso, karawala, Maldive fish, polos, gotukola, mukunuwenna, karapincha, kaha, uluhal, kurundu, wattalappam, kavum, condensed milk tea.

REPORT ANALYSIS: When patients share values or upload reports, identify and interpret all key values (lipid panel, CBC, glucose, HbA1c, renal, liver, TSH, uric acid, hsCRP) in Sri Lankan context. Flag values concerning even if within Western normal ranges.

SAFETY: Emergency symptoms (chest pain, jaw/left arm pain, breathlessness at rest, severe headache, facial drooping, arm weakness, loss of consciousness, palpitations) → immediately say emergency care is needed and to call 1990 (Suwa Seriya). Never prescribe doses. Never give definitive diagnoses. Always recommend in-person evaluation.

HEALTH PROFILE: If a patient profile is provided, you already know this patient. Reference their details naturally.

STYLE: Warm, trustworthy, deeply respectful. Culturally sensitive. Sri Lankan food names used naturally. Focused follow-up questions.`;

function buildSystemPrompt(profile, lang) {
  const t = L[lang]||L.en;
  let p = BASE_PROMPT + (t.lang_instruction||'');
  const vals = profile ? Object.values(profile).filter(v=>v&&v.toString().trim()) : [];
  if (!vals.length) return p;
  const lines = ['\n\nPATIENT HEALTH PROFILE (you already know this patient):'];
  if (profile.name)          lines.push(`- Name: ${profile.name}`);
  if (profile.age)           lines.push(`- Age: ${profile.age}`);
  if (profile.gender)        lines.push(`- Gender: ${profile.gender}`);
  if (profile.weight)        lines.push(`- Weight: ${profile.weight}kg`);
  if (profile.height)        lines.push(`- Height: ${profile.height}cm`);
  if (profile.conditions)    lines.push(`- Known conditions: ${profile.conditions}`);
  if (profile.medications)   lines.push(`- Medications: ${profile.medications}`);
  if (profile.allergies)     lines.push(`- Allergies: ${profile.allergies}`);
  if (profile.familyHistory) lines.push(`- Family history: ${profile.familyHistory}`);
  if (profile.smoking)       lines.push(`- Smoking: ${profile.smoking}`);
  if (profile.alcohol)       lines.push(`- Alcohol: ${profile.alcohol}`);
  if (profile.exercise)      lines.push(`- Exercise: ${profile.exercise}`);
  if (profile.diet)          lines.push(`- Diet: ${profile.diet}`);
  if (profile.notes)         lines.push(`- Notes: ${profile.notes}`);
  return p + lines.join('\n');
}

// ── Icons ──────────────────────────────────────────────────
const HeartIcon = ({size=20,color="white"}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/></svg>;
const SendIcon  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>;
const TrashIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const KeyIcon   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.85 11.15l8.3-8.3"/><path d="M19 3l2 2-4 4-2-2"/><path d="M17 7l2 2"/></svg>;
const ProfileIcon=()=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const CloseIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const SaveIcon  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
const ClipIcon  = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
const XIcon     = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const CloudIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>;
const EyeIcon   = ({show}) => show
  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;

// ── Formatting ─────────────────────────────────────────────
const renderInline = (text) =>
  text.split(/(\*\*[^*]+\*\*)/).map((p,i)=>
    p.startsWith('**')&&p.endsWith('**')
      ? <strong key={i} style={{fontWeight:500,color:"#6B2D3E"}}>{p.slice(2,-2)}</strong>
      : p
  );
const formatMsg = (text) => {
  const lines=text.split('\n'); const els=[]; let list=[]; let k=0;
  const flush=()=>{if(list.length){els.push(<ul key={k++} style={{margin:"8px 0 8px 18px"}}>{list.map((x,i)=><li key={i} style={{marginBottom:4}}>{x}</li>)}</ul>);list=[];}};
  lines.forEach((line,idx)=>{
    const tr=line.trim();
    if(tr.match(/^[-•*]\s+/)) list.push(renderInline(tr.replace(/^[-•*]\s+/,'')));
    else { flush(); if(tr) els.push(<p key={k++} style={{marginBottom:idx<lines.length-1?8:0}}>{renderInline(tr)}</p>); }
  });
  flush(); return els;
};

const dateLbl = (ts, t) => {
  const d=new Date(ts), today=new Date(), yest=new Date(today);
  yest.setDate(today.getDate()-1);
  if(d.toDateString()===today.toDateString()) return t.today;
  if(d.toDateString()===yest.toDateString()) return t.yesterday;
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
};
const groupByDate = (msgs, t) => {
  const out=[]; let last=null;
  msgs.forEach(m=>{ const lbl=m.ts?dateLbl(m.ts,t):null; if(lbl&&lbl!==last){out.push({type:'d',lbl});last=lbl;} out.push({type:'m',...m}); });
  return out;
};

// ── UI pieces ──────────────────────────────────────────────
const TypingDots = () => (
  <div style={{display:"flex",gap:10,alignSelf:"flex-start",maxWidth:"88%"}}>
    <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:4}}><HeartIcon size={16}/></div>
    <div style={{background:"#fff",border:"1px solid #DDD0BB",borderRadius:16,borderTopLeftRadius:4,padding:"14px 18px",display:"flex",gap:5,alignItems:"center",boxShadow:"0 2px 12px rgba(44,24,16,0.08)"}}>
      {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#8B6B4A",animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>)}
    </div>
  </div>
);

const Message = ({role,text,attachments}) => {
  const isDoc=role==='doctor';
  return (
    <div style={{display:"flex",gap:10,maxWidth:"88%",alignSelf:isDoc?"flex-start":"flex-end",flexDirection:isDoc?"row":"row-reverse",animation:"fadeUp 0.3s ease"}}>
      {isDoc&&<div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:4}}><HeartIcon size={16}/></div>}
      <div style={{maxWidth:"100%"}}>
        {attachments?.length>0&&(
          <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:6,alignItems:isDoc?"flex-start":"flex-end"}}>
            {attachments.map((a,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:7,background:"#F5F0E8",border:"1px solid #DDD0BB",borderRadius:8,padding:"5px 10px"}}>
                <span style={{fontSize:15}}>{a.type==='image'?'🖼️':'📄'}</span>
                <span style={{fontSize:12,color:"#5C4033",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</span>
              </div>
            ))}
          </div>
        )}
        {text&&(
          <div style={{padding:"12px 16px",borderRadius:16,borderTopLeftRadius:isDoc?4:16,borderTopRightRadius:isDoc?16:4,fontSize:14.5,lineHeight:1.65,background:isDoc?"#fff":"#2C1810",border:isDoc?"1px solid #DDD0BB":"none",color:isDoc?"#2C1810":"#FAF7F2",boxShadow:isDoc?"0 2px 12px rgba(44,24,16,0.08)":"none"}}>
            {isDoc?formatMsg(text):<p style={{margin:0}}>{text}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

const DateDiv = ({label}) => (
  <div style={{display:"flex",alignItems:"center",gap:12,margin:"4px 0"}}>
    <div style={{flex:1,height:"0.5px",background:"#DDD0BB"}}/>
    <span style={{fontSize:11,color:"#8B7355",fontWeight:500,whiteSpace:"nowrap"}}>{label}</span>
    <div style={{flex:1,height:"0.5px",background:"#DDD0BB"}}/>
  </div>
);

const FileChip = ({file,onRemove}) => (
  <div style={{display:"flex",alignItems:"center",gap:7,background:"#F5F0E8",border:"1px solid #DDD0BB",borderRadius:10,padding:"5px 10px",maxWidth:200}}>
    <span style={{fontSize:16}}>{file.type.startsWith('image/')?'🖼️':'📄'}</span>
    <span style={{fontSize:12,color:"#5C4033",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{file.name}</span>
    <button onClick={onRemove} style={{background:"none",border:"none",cursor:"pointer",color:"#8B7355",padding:2,display:"flex"}}><XIcon/></button>
  </div>
);

// ── Health Profile modal ───────────────────────────────────
const FIELDS = [
  {section:"Personal Details"},
  {key:"name",label:"Full Name",placeholder:"e.g. Kavindu Perera",type:"text"},
  {key:"age",label:"Age",placeholder:"e.g. 45",type:"number"},
  {key:"gender",label:"Gender",placeholder:"Male / Female / Other",type:"text"},
  {key:"weight",label:"Weight (kg)",placeholder:"e.g. 72",type:"number"},
  {key:"height",label:"Height (cm)",placeholder:"e.g. 168",type:"number"},
  {section:"Medical History"},
  {key:"conditions",label:"Known Medical Conditions",placeholder:"e.g. Type 2 Diabetes, Hypertension",type:"textarea"},
  {key:"medications",label:"Current Medications",placeholder:"e.g. Metformin 500mg, Atorvastatin 20mg",type:"textarea"},
  {key:"allergies",label:"Allergies",placeholder:"e.g. Penicillin, or None known",type:"text"},
  {key:"familyHistory",label:"Family Heart History",placeholder:"e.g. Father had heart attack at 55",type:"textarea"},
  {section:"Lifestyle"},
  {key:"smoking",label:"Smoking",placeholder:"e.g. Non-smoker / 10 cigarettes/day",type:"text"},
  {key:"alcohol",label:"Alcohol",placeholder:"e.g. Occasional / Daily arrack / None",type:"text"},
  {key:"exercise",label:"Exercise",placeholder:"e.g. 30 min walk 3x/week / Sedentary",type:"text"},
  {key:"diet",label:"Diet Notes",placeholder:"e.g. Rice 3x daily, lots of coconut",type:"textarea"},
  {section:"Other"},
  {key:"notes",label:"Other Notes / Recent Tests",placeholder:"e.g. LDL 4.2, HDL 0.9 (March 2025)",type:"textarea"},
];

const ProfileModal = ({profile,onSave,onClose,t}) => {
  const [form,setForm]=useState({...profile}); const [saved,setSaved]=useState(false);
  const save=()=>{onSave(form);setSaved(true);setTimeout(()=>setSaved(false),2000);};
  const hasData=Object.values(form).some(v=>v&&v.toString().trim());
  const inp={width:"100%",border:"1px solid #DDD0BB",borderRadius:10,padding:"9px 12px",fontFamily:"inherit",fontSize:13.5,color:"#2C1810",background:"#fff",outline:"none",boxSizing:"border-box",resize:"vertical"};
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(44,24,16,0.5)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#FAF7F2",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:520,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 -8px 40px rgba(44,24,16,0.2)"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 18px 14px",borderBottom:"1px solid #DDD0BB",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center"}}><ProfileIcon/></div>
          <div><div style={{fontFamily:"Georgia,serif",fontSize:15,fontWeight:600,color:"#2C1810"}}>{t.profile_title}</div><div style={{fontSize:11,color:"#8B7355",marginTop:1}}>{t.profile_sub}</div></div>
          <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#8B7355",display:"flex",padding:4}}><CloseIcon/></button>
        </div>
        <div style={{margin:"10px 14px 0",background:"#E8F4F1",borderRadius:10,padding:"9px 12px",fontSize:12,color:"#1A6B5A",lineHeight:1.6,flexShrink:0}}>{t.profile_tip}</div>
        <div style={{overflowY:"auto",padding:"10px 14px 18px",flex:1}} className="dr-scroll">
          {FIELDS.map((f,i)=>{
            if(f.section) return <div key={i} style={{fontSize:10.5,fontWeight:600,color:"#8B7355",textTransform:"uppercase",letterSpacing:"0.8px",margin:"18px 0 9px",borderBottom:"1px solid #DDD0BB",paddingBottom:5}}>{f.section}</div>;
            const val=form[f.key]||"";
            return (
              <div key={f.key} style={{marginBottom:10}}>
                <label style={{fontSize:12,fontWeight:500,color:"#5C4033",display:"block",marginBottom:3}}>{f.label}</label>
                {f.type==="textarea"
                  ?<textarea rows={2} value={val} placeholder={f.placeholder} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} style={{...inp,minHeight:52}} onFocus={e=>e.target.style.borderColor="#8B6B4A"} onBlur={e=>e.target.style.borderColor="#DDD0BB"}/>
                  :<input type={f.type} value={val} placeholder={f.placeholder} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} style={inp} onFocus={e=>e.target.style.borderColor="#8B6B4A"} onBlur={e=>e.target.style.borderColor="#DDD0BB"}/>
                }
              </div>
            );
          })}
        </div>
        <div style={{padding:"10px 14px",borderTop:"1px solid #DDD0BB",display:"flex",gap:8,flexShrink:0}}>
          {hasData&&<button onClick={()=>{onSave({});onClose();}} style={{padding:"9px 14px",borderRadius:10,border:"1px solid #DDD0BB",background:"transparent",color:"#8B7355",fontSize:12.5,cursor:"pointer",fontFamily:"inherit"}}>{t.profile_clear}</button>}
          <button onClick={save} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:saved?"#1A6B5A":"#6B2D3E",color:"#fff",fontSize:13.5,fontWeight:500,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6,transition:"background 0.3s"}}>
            <SaveIcon/> {saved?t.profile_saved:t.profile_save}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Key setup screen ───────────────────────────────────────
const KeySetupScreen = ({onSave}) => {
  const [key,setKey]=useState(""); const [show,setShow]=useState(false);
  const [err,setErr]=useState(""); const [busy,setBusy]=useState(false);
  async function go() {
    if(!key.trim().startsWith("gsk_")){setErr("Groq API keys start with gsk_ — please check.");return;}
    setBusy(true);setErr("");
    try{
      const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key.trim()}`},body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"user",content:"Hi"}],max_tokens:5})});
      if(r.ok) onSave(key.trim());
      else{const d=await r.json();setErr(d.error?.message||"Invalid key.");}
    }catch{setErr("Cannot connect to Groq. Check your internet.");}
    setBusy(false);
  }
  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#FAF7F2",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:20,padding:30,maxWidth:440,width:"100%",boxShadow:"0 8px 40px rgba(44,24,16,0.12)",border:"1px solid #DDD0BB"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:26}}>
          <div style={{width:60,height:60,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}><HeartIcon size={30}/></div>
          <h1 style={{fontFamily:"Georgia,serif",fontSize:21,fontWeight:600,color:"#2C1810",margin:0}}>Dr. Cardio</h1>
          <p style={{fontSize:12.5,color:"#8B7355",marginTop:3,textAlign:"center"}}>Sri Lankan Heart & General Health Advisor</p>
        </div>
        <div style={{background:"#F5F0E8",borderRadius:12,padding:"12px 14px",marginBottom:20,fontSize:12.5,color:"#5C4033",lineHeight:1.6}}><strong style={{color:"#2C1810"}}>One-time setup.</strong> Free Groq API key — no credit card required.</div>
        {[
          {n:"1",text:<span>Go to <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{color:"#6B2D3E",fontWeight:500}}>console.groq.com</a> and sign up free</span>},
          {n:"2",text:'Click "API Keys" → Create API Key'},
          {n:"3",text:"Copy and paste it below"},
        ].map(s=>(
          <div key={s.n} style={{display:"flex",gap:10,alignItems:"flex-start",marginBottom:10}}>
            <div style={{width:22,height:22,borderRadius:"50%",background:"#6B2D3E",color:"#fff",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{s.n}</div>
            <p style={{fontSize:12.5,color:"#5C4033",lineHeight:1.6,margin:"1px 0"}}>{s.text}</p>
          </div>
        ))}
        <div style={{position:"relative",marginTop:18}}>
          <input type={show?"text":"password"} value={key} onChange={e=>setKey(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')go();}} placeholder="gsk_••••••••••••••••••••" style={{width:"100%",border:"1px solid #DDD0BB",borderRadius:12,padding:"11px 40px 11px 14px",fontFamily:"inherit",fontSize:13.5,color:"#2C1810",background:"#FAF7F2",outline:"none",boxSizing:"border-box"}} onFocus={e=>e.target.style.borderColor="#8B6B4A"} onBlur={e=>e.target.style.borderColor="#DDD0BB"}/>
          <button onClick={()=>setShow(v=>!v)} style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#8B7355",display:"flex"}}><EyeIcon show={show}/></button>
        </div>
        {err&&<p style={{fontSize:12,color:"#C0392B",marginTop:7,marginBottom:0}}>{err}</p>}
        <button onClick={go} disabled={!key.trim()||busy} style={{width:"100%",marginTop:14,padding:"12px",borderRadius:12,background:!key.trim()||busy?"#C9A48A":"#6B2D3E",color:"#fff",border:"none",fontSize:14.5,fontWeight:500,cursor:!key.trim()||busy?"not-allowed":"pointer",fontFamily:"inherit"}} onMouseEnter={e=>{if(key.trim()&&!busy)e.currentTarget.style.background="#C0392B";}} onMouseLeave={e=>{if(key.trim()&&!busy)e.currentTarget.style.background="#6B2D3E";}}>
          {busy?"Verifying…":"Start Consultation →"}
        </button>
        {CLOUD_ENABLED&&<div style={{background:"#E8F4F1",borderRadius:10,padding:"9px 12px",marginTop:12,fontSize:11.5,color:"#1A6B5A",textAlign:"center",lineHeight:1.5}}>☁️ <strong>Cross-device sync enabled.</strong> Your history follows your API key on any device.</div>}
        <p style={{fontSize:11,color:"#A0896E",textAlign:"center",marginTop:12,lineHeight:1.6}}>🔒 Saved permanently on this device. <strong>Never asked again.</strong></p>
      </div>
    </div>
  );
};

// ── Main App ───────────────────────────────────────────────
export default function DrCardio() {
  const [apiKey,setApiKey]               = useState(null);
  const [userId,setUserId]               = useState(null);
  const [keyLoading,setKeyLoading]       = useState(true);
  const [lang,setLang]                   = useState('en');
  const [profile,setProfile]             = useState({});
  const [showProfile,setShowProfile]     = useState(false);
  const [messages,setMessages]           = useState([]);
  const [input,setInput]                 = useState("");
  const [pendingFiles,setPendingFiles]   = useState([]);
  const [loading,setLoading]             = useState(false);
  const [fileProcessing,setFileProcessing]=useState(false);
  const [showEmergency,setShowEmergency] = useState(false);
  const [showQuick,setShowQuick]         = useState(true);
  const [initialized,setInitialized]     = useState(false);
  const [syncStatus,setSyncStatus]       = useState('idle'); // idle|syncing|synced|error

  const messagesEndRef = useRef(null);
  const historyRef     = useRef([]);
  const profileRef     = useRef({});
  const langRef        = useRef('en');
  const userIdRef      = useRef(null);
  const textareaRef    = useRef(null);
  const fileInputRef   = useRef(null);
  const syncTimer      = useRef(null);

  const t = L[lang]||L.en;
  const EMERGENCY_KEYWORDS = ['chest pain','chest tightness','jaw pain','arm pain','breathless',"can't breathe",'loss of consciousness','fainted','collapsed','stroke','face drooping','slurred speech'];

  // ── CSS ──────────────────────────────────────────────────
  useEffect(()=>{
    const s=document.createElement('style');
    s.textContent=`@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-6px);opacity:1}}@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.5);opacity:0}}@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}@keyframes ecgScroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}*{box-sizing:border-box}body{margin:0}.dr-scroll::-webkit-scrollbar{width:4px}.dr-scroll::-webkit-scrollbar-track{background:transparent}.dr-scroll::-webkit-scrollbar-thumb{background:#DDD0BB;border-radius:2px}`;
    document.head.appendChild(s); loadKey(); return()=>document.head.removeChild(s);
  },[]);

  useEffect(()=>{messagesEndRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  // ── Debounced cloud sync ─────────────────────────────────
  const scheduleSync = useCallback((uid, payload) => {
    if (!CLOUD_ENABLED || !uid) return;
    clearTimeout(syncTimer.current);
    setSyncStatus('syncing');
    syncTimer.current = setTimeout(async()=>{
      await cloudSave(uid, payload);
      setSyncStatus('synced');
      setTimeout(()=>setSyncStatus('idle'),3000);
    }, 1500);
  },[]);

  // ── Load key & bootstrap ─────────────────────────────────
  async function loadKey() {
    const rawKey = ls.getRaw(LS_KEY_STORAGE);
    if (!rawKey) { setKeyLoading(false); return; }
    setApiKey(rawKey);
    const uid = await hashKey(rawKey);
    setUserId(uid); userIdRef.current = uid;
    await bootstrap(rawKey, uid);
  }

  async function bootstrap(key, uid) {
    setKeyLoading(false);
    // Try cloud first, then localStorage cache
    let data = null;
    if (CLOUD_ENABLED) {
      setSyncStatus('syncing');
      data = await cloudLoad(uid);
      setSyncStatus(data ? 'synced' : 'idle');
      setTimeout(()=>setSyncStatus('idle'),2000);
    }
    // Fall back to localStorage cache
    if (!data) data = ls.get(LS_CACHE);

    if (data) {
      const prof  = data.profile  || {};
      const msgs  = data.chat_messages || [];
      const hist  = data.api_history || [];
      const lang_ = data.language || 'en';
      setProfile(prof);  profileRef.current = prof;
      setLang(lang_);    langRef.current    = lang_;
      if (msgs.length > 0) {
        setMessages(msgs);
        historyRef.current = hist;
        setShowQuick(false);
        setInitialized(true);
        // Update localStorage cache
        ls.set(LS_CACHE, data);
        return;
      }
    }
    // No history — start fresh
    const prof = (data?.profile)||{}; const lang_ = (data?.language)||'en';
    setProfile(prof); profileRef.current=prof; setLang(lang_); langRef.current=lang_;
    await initConversation(key, prof, lang_);
  }

  // ── Persist helper ───────────────────────────────────────
  function persist(msgs, hist, prof, lang_) {
    const clean = cleanMsgsForStorage(msgs);
    const trimmedHist = hist.slice(-MAX_API_HISTORY);
    const payload = {
      profile:       prof  !== undefined ? prof  : profileRef.current,
      chat_messages: clean,
      api_history:   trimmedHist,
      language:      lang_ !== undefined ? lang_ : langRef.current,
    };
    ls.set(LS_CACHE, payload);
    scheduleSync(userIdRef.current, payload);
    return payload;
  }

  // ── Init conversation ────────────────────────────────────
  async function initConversation(key, prof, lang_) {
    setLoading(true);
    const hasProfile = prof && Object.values(prof).some(v=>v&&v.toString().trim());
    const lt = L[lang_]||L.en;
    const introPrompt = hasProfile ? lt.intro_return : lt.intro_new;
    try {
      const introHist = [{role:"user",content:introPrompt}];
      const reply = await groqCall(introHist, key, prof, lang_);
      const newHist = [...introHist,{role:"assistant",content:reply}];
      historyRef.current = newHist;
      const newMsgs = [{role:"doctor",text:reply,ts:Date.now()}];
      setMessages(newMsgs); setInitialized(true);
      persist(newMsgs, newHist, prof, lang_);
    } catch(e) {
      setMessages([{role:"doctor",text:`Connection issue: ${e.message}. Please check your API key.`,ts:Date.now()}]);
    }
    setLoading(false);
  }

  // ── Groq API call ────────────────────────────────────────
  async function groqCall(history, key, prof, lang_, isVision=false, imgB64=null, imgMime=null) {
    const k   = key  || apiKey;
    const p   = prof !== undefined ? prof  : profileRef.current;
    const lc  = lang_!== undefined ? lang_ : langRef.current;
    const mdl = isVision ? GROQ_VISION_MODEL : GROQ_MODEL;
    let msgs;
    if (isVision && imgB64) {
      const lastU   = history[history.length-1];
      const txt     = lastU?.role==='user'?(typeof lastU.content==='string'?lastU.content:t.send_file):t.send_file;
      const prevHist= history.slice(0,-1);
      msgs = [
        {role:"system",content:buildSystemPrompt(p,lc)},
        ...prevHist,
        {role:"user",content:[{type:"image_url",image_url:{url:`data:${imgMime};base64,${imgB64}`}},{type:"text",text:txt}]}
      ];
    } else {
      msgs = [{role:"system",content:buildSystemPrompt(p,lc)},...history];
    }
    const res  = await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${k}`},body:JSON.stringify({model:mdl,max_tokens:1024,messages:msgs})});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message||"Groq error");
    return data.choices[0].message.content;
  }

  // ── Handle key save ──────────────────────────────────────
  async function handleKeySave(key) {
    ls.setRaw(LS_KEY_STORAGE, key);
    const verify = ls.getRaw(LS_KEY_STORAGE);
    if (!verify) { alert("Could not save key — browser may be in Private mode."); return; }
    setApiKey(key);
    const uid = await hashKey(key);
    setUserId(uid); userIdRef.current = uid;
    await bootstrap(key, uid);
  }

  // ── Profile save ─────────────────────────────────────────
  function handleProfileSave(np) {
    setProfile(np); profileRef.current = np;
    persist(messages, historyRef.current, np, undefined);
  }

  // ── Language switch ───────────────────────────────────────
  function switchLang(code) {
    setLang(code); langRef.current = code;
    persist(messages, historyRef.current, undefined, code);
  }

  // ── Clear history ─────────────────────────────────────────
  function clearHistory() {
    historyRef.current = [];
    setMessages([]); setShowQuick(true); setInitialized(false); setShowEmergency(false);
    initConversation(apiKey, profileRef.current, langRef.current);
  }

  // ── Reset key ─────────────────────────────────────────────
  function resetKey() {
    if (!window.confirm("Reset your Groq API key?\n\nYour health profile will be kept locally.")) return;
    ls.del(LS_KEY_STORAGE); ls.del(LS_CACHE);
    setApiKey(null); setUserId(null); userIdRef.current=null;
    setMessages([]); historyRef.current=[]; setInitialized(false);
  }

  // ── File select ───────────────────────────────────────────
  function handleFileSelect(e) {
    const files = Array.from(e.target.files).filter(f=>f.type.startsWith('image/')||f.type==='application/pdf');
    setPendingFiles(prev=>[...prev,...files.slice(0,3-prev.length)]);
    e.target.value='';
  }

  // ── Send message ──────────────────────────────────────────
  async function send(preset) {
    const text = preset ?? input;
    if ((!text.trim() && pendingFiles.length===0) || loading) return;
    setShowQuick(false); setInput("");
    if (textareaRef.current) textareaRef.current.style.height="auto";

    const curLang = langRef.current;
    const files   = [...pendingFiles];
    setPendingFiles([]);

    const attachDisp = files.map(f=>({type:f.type.startsWith('image/')?'image':'pdf',name:f.name}));
    const userMsg    = {role:"user",text:text.trim()||(t.send_file),attachments:attachDisp.length?attachDisp:undefined,ts:Date.now()};
    const newMsgs    = [...messages, userMsg];
    setMessages(newMsgs); setLoading(true);

    try {
      let reply;
      if (files.length > 0) {
        const file    = files[0];
        const isImage = file.type.startsWith('image/');
        if (isImage) {
          setFileProcessing(true);
          const b64 = await fileToBase64(file);
          setFileProcessing(false);
          const ua  = {role:"user",content:text.trim()||t.send_file};
          const nh  = [...historyRef.current, ua];
          reply = await groqCall(nh, null, null, curLang, true, b64, file.type);
          historyRef.current = [...nh,{role:"assistant",content:reply}];
        } else {
          setFileProcessing(true);
          let pdfText;
          try   { pdfText = await extractPdfText(file); }
          catch { pdfText = "[PDF text extraction failed — please type the key values manually.]"; }
          setFileProcessing(false);
          const combined = `${text.trim()?text.trim()+"\n\n":""}[UPLOADED PDF: ${file.name}]\n\n${pdfText.substring(0,6000)}`;
          const ua  = {role:"user",content:combined};
          const nh  = [...historyRef.current, ua];
          historyRef.current = nh;
          reply = await groqCall(nh, null, null, curLang);
          historyRef.current = [...nh,{role:"assistant",content:reply}];
        }
      } else {
        const ua = {role:"user",content:text.trim()};
        const nh = [...historyRef.current, ua];
        historyRef.current = nh;
        reply = await groqCall(nh, null, null, curLang);
        historyRef.current = [...nh,{role:"assistant",content:reply}];
      }
      const docMsg   = {role:"doctor",text:reply,ts:Date.now()};
      const finalMsg = [...newMsgs, docMsg];
      setMessages(finalMsg);
      persist(finalMsg, historyRef.current, undefined, undefined);
      if (EMERGENCY_KEYWORDS.some(k=>reply.toLowerCase().includes(k))) setShowEmergency(true);
    } catch(e) {
      setMessages(prev=>[...prev,{role:"doctor",text:`I apologise — ${e.message}. Please try again.`,ts:Date.now()}]);
    }
    setFileProcessing(false); setLoading(false);
  }

  const handleKey   = e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} };
  const autoResize  = el => { el.style.height="auto"; el.style.height=Math.min(el.scrollHeight,120)+"px"; };
  const grouped     = groupByDate(messages, t);
  const profFilled  = Object.values(profile).some(v=>v&&v.toString().trim());

  // ── Render: loading ───────────────────────────────────────
  if (keyLoading) return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#FAF7F2",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",color:"#8B7355"}}>
        <div style={{width:46,height:46,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><HeartIcon size={22}/></div>
        <p style={{fontSize:13}}>Loading{CLOUD_ENABLED?" & syncing…":"…"}</p>
      </div>
    </div>
  );

  if (!apiKey) return <KeySetupScreen onSave={handleKeySave}/>;

  // Sync indicator
  const syncEl = CLOUD_ENABLED ? (
    syncStatus==='syncing' ? <span style={{fontSize:11,color:"#8B7355",display:"flex",alignItems:"center",gap:3}}><CloudIcon/> {t.syncing}</span>
    : syncStatus==='synced' ? <span style={{fontSize:11,color:"#1A6B5A",display:"flex",alignItems:"center",gap:3}}><CloudIcon/> {t.synced}</span>
    : null
  ) : <span style={{fontSize:10,color:"#C4A882"}}>{t.local}</span>;

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#FAF7F2",height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {showProfile && <ProfileModal profile={profile} onSave={handleProfileSave} onClose={()=>setShowProfile(false)} t={t}/>}

      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #DDD0BB",padding:"9px 14px",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{position:"relative",width:42,height:42,flexShrink:0}}>
          <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"2px solid #C0392B",animation:"pulse 2s ease-out infinite",opacity:0}}/>
          <div style={{width:42,height:42,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center"}}><HeartIcon size={21}/></div>
        </div>
        <div>
          <div style={{fontFamily:"Georgia,serif",fontSize:15.5,fontWeight:600,color:"#2C1810"}}>Dr. Cardio</div>
          <div style={{fontSize:11,color:"#8B7355",marginTop:1,display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:"#22C55E",display:"inline-block",animation:"blink 2s ease-in-out infinite"}}/>
            General Physician & Senior Cardiologist · Sri Lanka
          </div>
        </div>

        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5}}>
          {syncEl}

          {/* Language */}
          <div style={{display:"flex",background:"#F5F0E8",borderRadius:20,padding:2,border:"1px solid #DDD0BB"}}>
            {['en','si'].map(c=>(
              <button key={c} onClick={()=>switchLang(c)} style={{padding:"3px 9px",borderRadius:18,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11.5,fontWeight:lang===c?600:400,background:lang===c?"#6B2D3E":"transparent",color:lang===c?"#fff":"#8B7355",transition:"all 0.2s"}}>
                {c==='en'?'EN':'සිං'}
              </button>
            ))}
          </div>

          {/* Profile */}
          <button onClick={()=>setShowProfile(true)} style={{display:"flex",alignItems:"center",gap:4,background:profFilled?"#6B2D3E":"transparent",border:`1px solid ${profFilled?"#6B2D3E":"#DDD0BB"}`,borderRadius:20,padding:"4px 9px",cursor:"pointer",color:profFilled?"#fff":"#8B7355",fontSize:11.5,fontWeight:500,transition:"all 0.2s"}}>
            <ProfileIcon/> {profFilled?`${t.my_profile} ✓`:t.my_profile}
          </button>

          {/* New chat */}
          {messages.length>0&&(
            <button onClick={clearHistory} style={{display:"flex",alignItems:"center",gap:4,background:"transparent",border:"1px solid #DDD0BB",borderRadius:20,padding:"4px 8px",cursor:"pointer",color:"#8B7355",fontSize:11}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#C0392B";e.currentTarget.style.color="#C0392B";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#DDD0BB";e.currentTarget.style.color="#8B7355";}}>
              <TrashIcon/> {t.new_chat}
            </button>
          )}

          {/* Reset key */}
          <button onClick={resetKey} title={t.reset_key} style={{display:"flex",alignItems:"center",gap:3,background:"transparent",border:"1px solid #EEE5D8",borderRadius:20,padding:"4px 8px",cursor:"pointer",color:"#C4A882",fontSize:11}} onMouseEnter={e=>{e.currentTarget.style.borderColor="#8B6B4A";e.currentTarget.style.color="#8B7355";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#EEE5D8";e.currentTarget.style.color="#C4A882";}}>
            <KeyIcon/> {t.reset_key}
          </button>
        </div>
      </div>

      {/* ECG strip */}
      <div style={{height:25,background:"#6B2D3E",flexShrink:0,overflow:"hidden",position:"relative"}}>
        <svg viewBox="0 0 800 28" style={{position:"absolute",height:"100%",width:1600,animation:"ecgScroll 4s linear infinite",opacity:0.6}}>
          <polyline points="0,14 40,14 50,14 55,4 60,24 65,2 70,26 75,14 80,14 120,14 130,14 135,4 140,24 145,2 150,26 155,14 160,14 200,14 210,14 215,4 220,24 225,2 230,26 235,14 240,14 280,14 290,14 295,4 300,24 305,2 310,26 315,14 320,14 360,14 370,14 375,4 380,24 385,2 390,26 395,14 400,14 440,14 450,14 455,4 460,24 465,2 470,26 475,14 480,14 520,14 530,14 535,4 540,24 545,2 550,26 555,14 560,14 600,14 610,14 615,4 620,24 625,2 630,26 635,14 640,14 680,14 690,14 695,4 700,24 705,2 710,26 715,14 720,14 760,14 770,14 775,4 780,24 785,2 790,26 795,14 800,14" fill="none" stroke="rgba(255,200,200,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Messages */}
      <div className="dr-scroll" style={{flex:1,overflowY:"auto",padding:"14px 14px",display:"flex",flexDirection:"column",gap:12}}>

        <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:12,padding:"11px 13px",display:"flex",gap:9,alignItems:"flex-start",flexShrink:0}}>
          <span style={{fontSize:17,lineHeight:1}}>⚕️</span>
          <div style={{fontSize:12.5,color:"#92400E",lineHeight:1.65}}>
            <strong style={{display:"block",marginBottom:2,color:"#78350F",fontSize:13}}>{t.disclaimer_title}</strong>
            {t.disclaimer_body}<strong>1990</strong>{t.disclaimer_end}
          </div>
        </div>

        {!profFilled&&initialized&&(
          <div style={{background:"#F0F9FF",border:"1px solid #BAE6FD",borderRadius:12,padding:"11px 13px",display:"flex",gap:9,alignItems:"center",cursor:"pointer"}} onClick={()=>setShowProfile(true)}>
            <span style={{fontSize:17}}>👤</span>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:500,color:"#0C4A6E"}}>{t.nudge_title}</div><div style={{fontSize:11.5,color:"#0369A1",marginTop:1}}>{t.nudge_body}</div></div>
            <span style={{fontSize:12,color:"#0369A1",fontWeight:500,whiteSpace:"nowrap"}}>{t.nudge_cta}</span>
          </div>
        )}

        {grouped.map((item,i)=>
          item.type==='d'
            ?<DateDiv key={`d${i}`} label={item.lbl}/>
            :<Message key={`m${i}`} role={item.role} text={item.text} attachments={item.attachments}/>
        )}
        {(loading||fileProcessing)&&<TypingDots/>}
        <div ref={messagesEndRef}/>
      </div>

      {showEmergency&&(
        <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:"9px 13px",fontSize:13,color:"#991B1B",margin:"0 14px 8px",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
          <span>⚠️</span><span>Medical emergency? Call <strong>1990</strong> (Suwa Seriya) or go to your nearest A&E now.</span>
        </div>
      )}

      {showQuick&&initialized&&(
        <div style={{padding:"0 14px 7px",display:"flex",gap:7,flexWrap:"wrap",flexShrink:0}}>
          {t.quick.map((q,i)=>(
            <button key={i} onClick={()=>send(q.msg)} style={{background:"#fff",border:"1px solid #DDD0BB",borderRadius:20,padding:"5px 13px",fontFamily:"inherit",fontSize:12.5,color:"#5C4033",cursor:"pointer",whiteSpace:"nowrap"}} onMouseEnter={e=>{e.target.style.background="#F5F0E8";e.target.style.borderColor="#8B6B4A";}} onMouseLeave={e=>{e.target.style.background="#fff";e.target.style.borderColor="#DDD0BB";}}>
              {q.icon} {q.label}
            </button>
          ))}
        </div>
      )}

      {pendingFiles.length>0&&(
        <div style={{padding:"0 14px 7px",display:"flex",gap:7,flexWrap:"wrap",flexShrink:0}}>
          {pendingFiles.map((f,i)=><FileChip key={i} file={f} onRemove={()=>setPendingFiles(p=>p.filter((_,j)=>j!==i))}/>)}
        </div>
      )}

      {/* Input */}
      <div style={{background:"#fff",borderTop:"1px solid #DDD0BB",padding:"9px 14px",flexShrink:0}}>
        <div style={{fontSize:10.5,color:"#8B7355",textAlign:"center",marginBottom:7,lineHeight:1.5}}>
          {t.footer} <strong>1990</strong>
        </div>
        <div style={{display:"flex",gap:7,alignItems:"flex-end"}}>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple style={{display:"none"}} onChange={handleFileSelect}/>
          <button onClick={()=>fileInputRef.current?.click()} disabled={loading||pendingFiles.length>=3} title={t.attach_tip} style={{width:40,height:40,borderRadius:11,background:pendingFiles.length>0?"#F5F0E8":"transparent",border:"1px solid #DDD0BB",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#8B6B4A",flexShrink:0,position:"relative"}} onMouseEnter={e=>{e.currentTarget.style.background="#F5F0E8";e.currentTarget.style.borderColor="#8B6B4A";}} onMouseLeave={e=>{if(!pendingFiles.length){e.currentTarget.style.background="transparent";e.currentTarget.style.borderColor="#DDD0BB";}}}>
            <ClipIcon/>
            {pendingFiles.length>0&&<span style={{position:"absolute",top:-4,right:-4,width:15,height:15,borderRadius:"50%",background:"#6B2D3E",color:"#fff",fontSize:9,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingFiles.length}</span>}
          </button>
          <textarea ref={textareaRef} value={input} onChange={e=>{setInput(e.target.value);autoResize(e.target);}} onKeyDown={handleKey} placeholder={pendingFiles.length>0?"Add a message or send the file directly…":t.placeholder} disabled={loading} rows={1} style={{flex:1,border:"1px solid #DDD0BB",borderRadius:13,padding:"10px 14px",fontFamily:"inherit",fontSize:13.5,color:"#2C1810",background:loading?"#F5F0E8":"#FAF7F2",resize:"none",outline:"none",lineHeight:1.5,minHeight:42,maxHeight:120,overflowY:"auto"}} onFocus={e=>{e.target.style.borderColor="#8B6B4A";e.target.style.background="#fff";}} onBlur={e=>{e.target.style.borderColor="#DDD0BB";e.target.style.background="#FAF7F2";}}/>
          <button onClick={()=>send()} disabled={loading||(!input.trim()&&pendingFiles.length===0)} style={{width:40,height:40,borderRadius:"50%",background:loading||(!input.trim()&&pendingFiles.length===0)?"#C9A48A":"#6B2D3E",border:"none",cursor:loading||(!input.trim()&&pendingFiles.length===0)?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} onMouseEnter={e=>{if(!loading&&(input.trim()||pendingFiles.length))e.currentTarget.style.background="#C0392B";}} onMouseLeave={e=>{if(!loading&&(input.trim()||pendingFiles.length))e.currentTarget.style.background="#6B2D3E";}}>
            <SendIcon/>
          </button>
        </div>
      </div>
    </div>
  );
}
