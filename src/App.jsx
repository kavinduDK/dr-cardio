import { useState, useEffect, useRef } from "react";

const BASE_SYSTEM_PROMPT = `You are Dr. Cardio — a fully qualified General Physician and Senior Consultant Cardiologist & Lipidologist with the equivalent of 60+ years of clinical experience. You hold the complete knowledge of a seasoned general doctor capable of understanding, assessing, and advising on the full spectrum of human health, while your deepest specialization lies in cardiovascular disease, heart health, cholesterol, and blood health, with a lifetime of focus on Sri Lankan patients, genetics, culture, food, and lifestyle.

You have spent your entire career treating Sri Lankan patients across all provinces — from Colombo to Kandy, Galle to Hambantota — and you understand the Sri Lankan body, lifestyle, and health landscape better than any other physician in the world.

YOUR GENERAL MEDICINE FOUNDATION: Complete working knowledge of internal medicine, respiratory, gastroenterology, nephrology, endocrinology, neurology, haematology, musculoskeletal, dermatology, infectious disease, men's and women's health, mental health, and pharmacology.

YOUR PRIMARY SPECIALIZATION — CARDIOVASCULAR & LIPID HEALTH: World-class expert in cardiovascular disease, coronary artery disease, heart failure, arrhythmias, lipidology (LDL, HDL, triglycerides, VLDL, lipoprotein(a), ApoB, non-HDL), Familial Hypercholesterolemia, genetic cardiovascular risk, blood health, and metabolic syndrome.

SRI LANKAN GENETIC & PHYSIOLOGICAL EXPERTISE:
- South Asian Paradox: Sri Lankans develop heart disease at lower BMI, younger ages, and lower cholesterol levels than Western counterparts
- Visceral adiposity: Sri Lankans store fat centrally even at normal body weight
- Ethnic-specific thresholds: Cardiovascular risk begins at waist >80cm (women) and >90cm (men)
- Insulin resistance: Genetically higher tendency, accelerating atherosclerosis
- Lipoprotein(a): Significantly more prevalent in South Asian genetics
- Always apply a 1.5–2x South Asian multiplier to standard risk scores

SRI LANKAN FOOD & DIETARY MASTERY: Encyclopaedic knowledge of Sri Lankan cuisine — rice, coconut, coconut milk (kiri), dal (parippu), pol sambol, string hoppers (indi appa), hoppers (appa), pittu, kiribath, kottu roti, tuna/thalapath, seer fish/thora, sardines/hurulla, sprats/halmasso, karawala, Maldive fish, jackfruit (polos, kos), gotukola, mukunuwenna, karapincha, turmeric (kaha), fenugreek (uluhal), cinnamon (kurundu), wattalappam, kavum, condensed milk tea. Practical, budget-conscious, culturally-fitted advice.

WHEN A PATIENT TYPES REPORT VALUES: Read carefully. Identify all key values — lipid panel, blood counts, glucose, HbA1c, renal profile, liver enzymes, thyroid (TSH), uric acid, hsCRP. Interpret every value in Sri Lankan clinical context. Flag concerning values even if within Western normal ranges. Explain results clearly and warmly.

CRITICAL SAFETY RULES: Emergency symptoms — chest pain, jaw or left arm pain, breathlessness at rest, sudden severe headache, facial drooping, arm weakness, loss of consciousness, severe palpitations → immediately say: "⚠️ This requires emergency care. Please go to your nearest hospital Accident & Emergency immediately or call 1990 (Suwa Seriya Ambulance) right now. Do not wait."
Never prescribe specific drug doses. Do not issue definitive diagnoses. Always recommend confirmatory in-person evaluation.

HEALTH PROFILE AWARENESS: If a patient health profile is provided at the start of the system context, you already know this patient. Reference their details naturally — use their name if provided, acknowledge their known conditions, medications and family history without asking them to repeat it. Build on what you know.

COMMUNICATION STYLE: Warm, trustworthy, deeply respectful. Culturally sensitive. Use Sri Lankan food names naturally. Simplify complex concepts. Ask focused follow-up questions. Balance scientific precision with human warmth.`;

function buildSystemPrompt(profile) {
  if (!profile || !Object.values(profile).some(v => v && v.toString().trim())) {
    return BASE_SYSTEM_PROMPT;
  }
  const lines = ["PATIENT HEALTH PROFILE (saved on this device — you already know this patient):"];
  if (profile.name)       lines.push(`- Name: ${profile.name}`);
  if (profile.age)        lines.push(`- Age: ${profile.age}`);
  if (profile.gender)     lines.push(`- Gender: ${profile.gender}`);
  if (profile.weight)     lines.push(`- Weight: ${profile.weight} kg`);
  if (profile.height)     lines.push(`- Height: ${profile.height} cm`);
  if (profile.conditions) lines.push(`- Known medical conditions: ${profile.conditions}`);
  if (profile.medications)lines.push(`- Current medications: ${profile.medications}`);
  if (profile.allergies)  lines.push(`- Allergies: ${profile.allergies}`);
  if (profile.familyHistory) lines.push(`- Family history: ${profile.familyHistory}`);
  if (profile.smoking)    lines.push(`- Smoking: ${profile.smoking}`);
  if (profile.alcohol)    lines.push(`- Alcohol: ${profile.alcohol}`);
  if (profile.exercise)   lines.push(`- Exercise: ${profile.exercise}`);
  if (profile.diet)       lines.push(`- Diet notes: ${profile.diet}`);
  if (profile.notes)      lines.push(`- Other notes: ${profile.notes}`);
  return BASE_SYSTEM_PROMPT + "\n\n" + lines.join("\n");
}

const EMERGENCY_KEYWORDS = ['chest pain','chest tightness','jaw pain','arm pain','breathless',"can't breathe",'loss of consciousness','fainted','collapsed','stroke','face drooping','slurred speech'];
const QUICK_PROMPTS = [
  { icon:"🩸", label:"High cholesterol", msg:"I have been told my cholesterol is high. What should I know?" },
  { icon:"🍛", label:"Heart-healthy foods", msg:"What Sri Lankan foods are good for my heart?" },
  { icon:"🧬", label:"Family heart history", msg:"My father had a heart attack at 52. Am I at risk?" },
  { icon:"📋", label:"Lipid panel", msg:"How do I understand my lipid panel / cholesterol blood test results?" },
];
const STORAGE_KEY  = 'drcardio-history';
const KEY_STORAGE  = 'drcardio-groq-key';
const PROFILE_KEY  = 'drcardio-profile';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

const store = {
  get: (k) => { try { const v = localStorage.getItem(k); return v ? { value: v } : null; } catch(e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} },
  del: (k) => { try { localStorage.removeItem(k); } catch(e) {} },
};

// ── Icons ──────────────────────────────────────────────────
function HeartIcon({ size=20, color="white" }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/></svg>;
}
function SendIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>; }
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>; }
function KeyIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.85 11.15l8.3-8.3"/><path d="M19 3l2 2-4 4-2-2"/><path d="M17 7l2 2"/></svg>; }
function ProfileIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function CloseIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function SaveIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>; }
function EyeIcon({ show }) {
  return show
    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
}

// ── Text formatting ────────────────────────────────────────
function renderInline(text) {
  return text.split(/(\*\*[^*]+\*\*)/).map((p,i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} style={{ fontWeight:500, color:"#6B2D3E" }}>{p.slice(2,-2)}</strong>
      : p
  );
}
function formatMessage(text) {
  const lines = text.split('\n');
  const els=[]; let list=[]; let k=0;
  const flush = () => { if(list.length){ els.push(<ul key={k++} style={{margin:"8px 0 8px 18px"}}>{list.map((x,i)=><li key={i} style={{marginBottom:4}}>{x}</li>)}</ul>); list=[]; }};
  lines.forEach((line,idx) => {
    const t = line.trim();
    if(t.match(/^[-•*]\s+/)) list.push(renderInline(t.replace(/^[-•*]\s+/,'')));
    else { flush(); if(t) els.push(<p key={k++} style={{marginBottom:idx<lines.length-1?8:0}}>{renderInline(t)}</p>); }
  });
  flush(); return els;
}

// ── Date helpers ───────────────────────────────────────────
function formatDateLabel(ts) {
  const d=new Date(ts), today=new Date(), yest=new Date(today);
  yest.setDate(today.getDate()-1);
  if(d.toDateString()===today.toDateString()) return "Today";
  if(d.toDateString()===yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
function groupByDate(msgs) {
  const out=[]; let last=null;
  msgs.forEach(m => {
    const lbl = m.ts ? formatDateLabel(m.ts) : null;
    if(lbl && lbl!==last){ out.push({type:'divider',lbl}); last=lbl; }
    out.push({type:'message',...m});
  });
  return out;
}

// ── Health Profile Modal ───────────────────────────────────
const PROFILE_FIELDS = [
  { section:"Personal Details" },
  { key:"name",      label:"Full Name",        placeholder:"e.g. Kavindu Perera",        type:"text" },
  { key:"age",       label:"Age",              placeholder:"e.g. 45",                    type:"number" },
  { key:"gender",    label:"Gender",           placeholder:"Male / Female / Other",      type:"text" },
  { key:"weight",    label:"Weight (kg)",      placeholder:"e.g. 72",                    type:"number" },
  { key:"height",    label:"Height (cm)",      placeholder:"e.g. 168",                   type:"number" },
  { section:"Medical History" },
  { key:"conditions",  label:"Known Medical Conditions", placeholder:"e.g. Type 2 Diabetes, Hypertension, High Cholesterol",  type:"textarea" },
  { key:"medications", label:"Current Medications",      placeholder:"e.g. Metformin 500mg, Atorvastatin 20mg",               type:"textarea" },
  { key:"allergies",   label:"Allergies",                placeholder:"e.g. Penicillin, Sulfa drugs, or None known",           type:"text" },
  { key:"familyHistory", label:"Family Heart History",   placeholder:"e.g. Father had heart attack at 55, mother has diabetes", type:"textarea" },
  { section:"Lifestyle" },
  { key:"smoking",   label:"Smoking",   placeholder:"e.g. Non-smoker / 10 cigarettes/day / Ex-smoker", type:"text" },
  { key:"alcohol",   label:"Alcohol",   placeholder:"e.g. Occasional / Daily arrack / None",            type:"text" },
  { key:"exercise",  label:"Exercise",  placeholder:"e.g. 30 min walk 3x/week / Sedentary",            type:"text" },
  { key:"diet",      label:"Diet Notes",placeholder:"e.g. Rice 3x daily, eats a lot of coconut, no red meat", type:"textarea" },
  { section:"Other" },
  { key:"notes",     label:"Other Notes / Recent Tests", placeholder:"e.g. Last lipid panel: LDL 4.2, HDL 0.9 (March 2025)", type:"textarea" },
];

function ProfileModal({ profile, onSave, onClose }) {
  const [form, setForm] = useState({ ...profile });
  const [saved, setSaved] = useState(false);

  function handleSave() {
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const hasData = Object.values(form).some(v => v && v.toString().trim());

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(44,24,16,0.5)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#FAF7F2",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:520,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 -8px 40px rgba(44,24,16,0.2)"}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{padding:"20px 20px 16px",borderBottom:"1px solid #DDD0BB",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
          <div style={{width:38,height:38,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <ProfileIcon()/>
          </div>
          <div>
            <div style={{fontFamily:"Georgia,serif",fontSize:16,fontWeight:600,color:"#2C1810"}}>My Health Profile</div>
            <div style={{fontSize:11.5,color:"#8B7355",marginTop:1}}>Saved on this device · Shared with Dr. Cardio every session</div>
          </div>
          <button onClick={onClose} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#8B7355",display:"flex",padding:4}}>
            <CloseIcon/>
          </button>
        </div>

        {/* Info banner */}
        <div style={{margin:"12px 16px 0",background:"#E8F4F1",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#1A6B5A",lineHeight:1.6,flexShrink:0}}>
          💡 Fill in as much or as little as you like. Dr. Cardio will use this to personalise every conversation — so you never have to repeat your history.
        </div>

        {/* Form */}
        <div style={{overflowY:"auto",padding:"12px 16px 20px",flex:1}} className="dr-scroll">
          {PROFILE_FIELDS.map((f, i) => {
            if (f.section) return (
              <div key={i} style={{fontSize:11,fontWeight:600,color:"#8B7355",textTransform:"uppercase",letterSpacing:"0.8px",margin:"20px 0 10px",borderBottom:"1px solid #DDD0BB",paddingBottom:6}}>
                {f.section}
              </div>
            );
            const val = form[f.key] || "";
            const inputStyle = {width:"100%",border:"1px solid #DDD0BB",borderRadius:10,padding:"9px 12px",fontFamily:"inherit",fontSize:13.5,color:"#2C1810",background:"#fff",outline:"none",boxSizing:"border-box",resize:"vertical"};
            return (
              <div key={f.key} style={{marginBottom:12}}>
                <label style={{fontSize:12.5,fontWeight:500,color:"#5C4033",display:"block",marginBottom:4}}>{f.label}</label>
                {f.type === "textarea"
                  ? <textarea rows={2} value={val} placeholder={f.placeholder} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} style={{...inputStyle,minHeight:56}} onFocus={e=>e.target.style.borderColor="#8B6B4A"} onBlur={e=>e.target.style.borderColor="#DDD0BB"}/>
                  : <input type={f.type} value={val} placeholder={f.placeholder} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} style={inputStyle} onFocus={e=>e.target.style.borderColor="#8B6B4A"} onBlur={e=>e.target.style.borderColor="#DDD0BB"}/>
                }
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{padding:"12px 16px",borderTop:"1px solid #DDD0BB",display:"flex",gap:10,flexShrink:0}}>
          {hasData && (
            <button onClick={()=>{onSave({}); onClose();}} style={{padding:"10px 16px",borderRadius:10,border:"1px solid #DDD0BB",background:"transparent",color:"#8B7355",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
              Clear Profile
            </button>
          )}
          <button onClick={handleSave} style={{flex:1,padding:"11px",borderRadius:10,border:"none",background:saved?"#1A6B5A":"#6B2D3E",color:"#fff",fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:7,transition:"background 0.3s"}}>
            <SaveIcon/> {saved ? "Saved ✓" : "Save Health Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{display:"flex",gap:10,alignSelf:"flex-start",maxWidth:"88%"}}>
      <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:4}}>
        <HeartIcon size={16}/>
      </div>
      <div style={{background:"#fff",border:"1px solid #DDD0BB",borderRadius:16,borderTopLeftRadius:4,padding:"14px 18px",display:"flex",gap:5,alignItems:"center",boxShadow:"0 2px 12px rgba(44,24,16,0.08)"}}>
        {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#8B6B4A",animation:`bounce 1.2s ease-in-out ${i*0.2}s infinite`}}/>)}
      </div>
    </div>
  );
}
function Message({ role, text }) {
  const isDoc = role==='doctor';
  return (
    <div style={{display:"flex",gap:10,maxWidth:"88%",alignSelf:isDoc?"flex-start":"flex-end",flexDirection:isDoc?"row":"row-reverse",animation:"fadeUp 0.3s ease"}}>
      {isDoc && <div style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:4}}><HeartIcon size={16}/></div>}
      <div style={{padding:"12px 16px",borderRadius:16,borderTopLeftRadius:isDoc?4:16,borderTopRightRadius:isDoc?16:4,fontSize:14.5,lineHeight:1.65,background:isDoc?"#fff":"#2C1810",border:isDoc?"1px solid #DDD0BB":"none",color:isDoc?"#2C1810":"#FAF7F2",boxShadow:isDoc?"0 2px 12px rgba(44,24,16,0.08)":"none",maxWidth:"100%"}}>
        {isDoc ? formatMessage(text) : <p style={{margin:0}}>{text}</p>}
      </div>
    </div>
  );
}
function DateDivider({ label }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,margin:"4px 0"}}>
      <div style={{flex:1,height:"0.5px",background:"#DDD0BB"}}/>
      <span style={{fontSize:11,color:"#8B7355",fontWeight:500,whiteSpace:"nowrap"}}>{label}</span>
      <div style={{flex:1,height:"0.5px",background:"#DDD0BB"}}/>
    </div>
  );
}

// ── Key Setup Screen ───────────────────────────────────────
function KeySetupScreen({ onSave }) {
  const [key, setKey]         = useState("");
  const [show, setShow]       = useState(false);
  const [err, setErr]         = useState("");
  const [testing, setTesting] = useState(false);

  async function handleSave() {
    if(!key.trim().startsWith("gsk_")){ setErr("Groq API keys start with gsk_ — please check and try again."); return; }
    setTesting(true); setErr("");
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${key.trim()}`},
        body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"user",content:"Hi"}],max_tokens:5})
      });
      if(res.ok){ onSave(key.trim()); }
      else { const d=await res.json(); setErr(d.error?.message||"Invalid key. Please check and try again."); }
    } catch(e){ setErr("Could not connect to Groq. Check your internet connection."); }
    setTesting(false);
  }

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#FAF7F2",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:20,padding:32,maxWidth:440,width:"100%",boxShadow:"0 8px 40px rgba(44,24,16,0.12)",border:"1px solid #DDD0BB"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:28}}>
          <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14}}><HeartIcon size={32}/></div>
          <h1 style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:600,color:"#2C1810",margin:0}}>Dr. Cardio</h1>
          <p style={{fontSize:13,color:"#8B7355",marginTop:4,textAlign:"center"}}>Sri Lankan Heart & General Health Advisor</p>
        </div>
        <div style={{background:"#F5F0E8",borderRadius:12,padding:"14px 16px",marginBottom:22,fontSize:13,color:"#5C4033",lineHeight:1.6}}>
          <strong style={{color:"#2C1810"}}>One-time setup.</strong> You need a free Groq API key. No credit card required.
        </div>
        {[
          {n:"1", text:<span>Go to <a href="https://console.groq.com" target="_blank" rel="noreferrer" style={{color:"#6B2D3E",fontWeight:500}}>console.groq.com</a> and sign up free</span>},
          {n:"2", text:'Click "API Keys" in the left sidebar → Create API Key'},
          {n:"3", text:"Copy and paste it below"},
        ].map(s=>(
          <div key={s.n} style={{display:"flex",gap:12,alignItems:"flex-start",marginBottom:12}}>
            <div style={{width:24,height:24,borderRadius:"50%",background:"#6B2D3E",color:"#fff",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{s.n}</div>
            <p style={{fontSize:13,color:"#5C4033",lineHeight:1.6,margin:"2px 0"}}>{s.text}</p>
          </div>
        ))}
        <div style={{position:"relative",marginTop:20}}>
          <input type={show?"text":"password"} value={key} onChange={e=>setKey(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')handleSave();}}
            placeholder="gsk_••••••••••••••••••••"
            style={{width:"100%",border:"1px solid #DDD0BB",borderRadius:12,padding:"12px 44px 12px 16px",fontFamily:"inherit",fontSize:14,color:"#2C1810",background:"#FAF7F2",outline:"none",boxSizing:"border-box"}}
            onFocus={e=>e.target.style.borderColor="#8B6B4A"} onBlur={e=>e.target.style.borderColor="#DDD0BB"}/>
          <button onClick={()=>setShow(v=>!v)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#8B7355",display:"flex",alignItems:"center"}}>
            <EyeIcon show={show}/>
          </button>
        </div>
        {err && <p style={{fontSize:12.5,color:"#C0392B",marginTop:8,marginBottom:0}}>{err}</p>}
        <button onClick={handleSave} disabled={!key.trim()||testing}
          style={{width:"100%",marginTop:16,padding:"13px",borderRadius:12,background:!key.trim()||testing?"#C9A48A":"#6B2D3E",color:"#fff",border:"none",fontSize:15,fontWeight:500,cursor:!key.trim()||testing?"not-allowed":"pointer",fontFamily:"inherit"}}
          onMouseEnter={e=>{if(key.trim()&&!testing)e.currentTarget.style.background="#C0392B";}}
          onMouseLeave={e=>{if(key.trim()&&!testing)e.currentTarget.style.background="#6B2D3E";}}>
          {testing?"Verifying…":"Start Consultation →"}
        </button>
        <p style={{fontSize:11,color:"#A0896E",textAlign:"center",marginTop:14,lineHeight:1.6}}>
          🔒 Your key is saved permanently on this device. You will <strong>never be asked again</strong> — not even after closing the browser. It is never sent anywhere except directly to Groq.
        </p>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────
export default function DrCardio() {
  const [apiKey, setApiKey]           = useState(null);
  const [keyLoading, setKeyLoading]   = useState(true);
  const [profile, setProfile]         = useState({});
  const [showProfile, setShowProfile] = useState(false);
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [showQuick, setShowQuick]     = useState(true);
  const [initialized, setInitialized] = useState(false);
  const messagesEndRef = useRef(null);
  const historyRef     = useRef([]);
  const textareaRef    = useRef(null);
  const profileRef     = useRef({});

  useEffect(() => {
    const s = document.createElement('style');
    s.textContent = `
      @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      @keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-6px);opacity:1}}
      @keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.5);opacity:0}}
      @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
      @keyframes ecgScroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
      *{box-sizing:border-box} body{margin:0}
      .dr-scroll::-webkit-scrollbar{width:4px}
      .dr-scroll::-webkit-scrollbar-track{background:transparent}
      .dr-scroll::-webkit-scrollbar-thumb{background:#DDD0BB;border-radius:2px}
    `;
    document.head.appendChild(s);
    loadKey();
    return () => document.head.removeChild(s);
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages, loading]);

  function loadKey() {
    // Load profile first
    const pr = store.get(PROFILE_KEY);
    const loadedProfile = pr?.value ? JSON.parse(pr.value) : {};
    setProfile(loadedProfile);
    profileRef.current = loadedProfile;

    const r = store.get(KEY_STORAGE);
    if(r?.value){ setApiKey(r.value); loadHistory(r.value, loadedProfile); }
    else { setKeyLoading(false); }
  }

  function loadHistory(key, loadedProfile) {
    setKeyLoading(false);
    const r = store.get(STORAGE_KEY);
    if(r?.value){
      try {
        const { messages:saved, apiHistory } = JSON.parse(r.value);
        if(saved?.length > 0){
          setMessages(saved);
          historyRef.current = apiHistory || [];
          setShowQuick(false);
          setInitialized(true);
          return;
        }
      } catch(e) {}
    }
    init(key, loadedProfile);
  }

  function saveHistory(msgs, apiHist) {
    store.set(STORAGE_KEY, JSON.stringify({ messages:msgs, apiHistory:apiHist }));
  }

  function clearHistory() {
    store.del(STORAGE_KEY);
    historyRef.current = [];
    setMessages([]); setShowQuick(true); setInitialized(false); setShowEmergency(false);
    init(apiKey, profileRef.current);
  }

  function changeKey() {
    const confirmed = window.confirm("Reset your Groq API key?\n\nYou will be asked to enter a new key. Your health profile will be kept.");
    if (!confirmed) return;
    store.del(KEY_STORAGE); store.del(STORAGE_KEY);
    setApiKey(null); setMessages([]); historyRef.current=[]; setInitialized(false);
  }

  function handleProfileSave(newProfile) {
    setProfile(newProfile);
    profileRef.current = newProfile;
    store.set(PROFILE_KEY, JSON.stringify(newProfile));
  }

  async function callGroq(history, key, prof) {
    const k = key || apiKey;
    const p = prof !== undefined ? prof : profileRef.current;
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${k}`},
      body:JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 1024,
        messages: [
          { role:"system", content: buildSystemPrompt(p) },
          ...history
        ]
      })
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error?.message||"Groq error");
    return data.choices[0].message.content;
  }

  async function init(key, prof) {
    setLoading(true);
    const p = prof !== undefined ? prof : profileRef.current;
    const hasProfile = p && Object.values(p).some(v => v && v.toString().trim());
    const introPrompt = hasProfile
      ? `Greet the patient by name if you know it, using 'Ayubowan and Welcome back!' as your opening. You already have their health profile. Briefly acknowledge 1-2 of their known conditions or history to show you remember them, then ask what brings them to you today. Use only English. Warm and personal, 3-4 sentences.`
      : `Introduce yourself with 'Ayubowan and Welcome!' as your opening greeting. Then briefly introduce yourself as Dr. Cardio, a Senior Consultant Cardiologist and Lipidologist dedicated to helping Sri Lankans achieve the best heart health and overall wellbeing. Mention you have cared for patients across Sri Lanka from Colombo to Kandy to Galle and are committed to personalized advice. End by asking what brings them to you today. Use only English — no Tamil words or greetings whatsoever. Keep it to 3-4 sentences, warm and welcoming.`;

    try {
      const introHist = [{role:"user", content: introPrompt}];
      const reply = await callGroq(introHist, key, p);
      const newHist = [...introHist,{role:"assistant",content:reply}];
      historyRef.current = newHist;
      const newMsgs = [{role:"doctor",text:reply,ts:Date.now()}];
      setMessages(newMsgs);
      setInitialized(true);
      saveHistory(newMsgs, newHist);
    } catch(e){
      setMessages([{role:"doctor",text:`Connection issue: ${e.message}. Please check your API key.`,ts:Date.now()}]);
    }
    setLoading(false);
  }

  function handleKeySave(key) {
    // Save twice for reliability, then verify it stuck
    store.set(KEY_STORAGE, key);
    store.set(KEY_STORAGE, key);
    const verify = store.get(KEY_STORAGE);
    if (!verify?.value) {
      alert("Could not save your API key to this browser. Please check your browser privacy settings (Private/Incognito mode blocks localStorage).");
      return;
    }
    setApiKey(key);
    setKeyLoading(false);
    init(key, profileRef.current);
  }

  async function send(preset) {
    const text = preset ?? input;
    if(!text.trim()||loading) return;
    setShowQuick(false);
    setInput("");
    if(textareaRef.current) textareaRef.current.style.height="auto";

    const userApiMsg = {role:"user",content:text.trim()};
    const newApiHist = [...historyRef.current, userApiMsg];
    historyRef.current = newApiHist;
    const userMsg = {role:"user",text:text.trim(),ts:Date.now()};
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setLoading(true);

    try {
      const reply = await callGroq(historyRef.current);
      const finalHist = [...historyRef.current,{role:"assistant",content:reply}];
      historyRef.current = finalHist;
      const docMsg = {role:"doctor",text:reply,ts:Date.now()};
      const finalMsgs = [...newMsgs, docMsg];
      setMessages(finalMsgs);
      saveHistory(finalMsgs, finalHist);
      if(EMERGENCY_KEYWORDS.some(k=>reply.toLowerCase().includes(k))) setShowEmergency(true);
    } catch(e){
      setMessages(prev=>[...prev,{role:"doctor",text:`I apologise — ${e.message}. Please try again.`,ts:Date.now()}]);
    }
    setLoading(false);
  }

  function handleKey(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} }
  function autoResize(el){ el.style.height="auto"; el.style.height=Math.min(el.scrollHeight,120)+"px"; }

  const grouped = groupByDate(messages);
  const profileFilled = Object.values(profile).some(v => v && v.toString().trim());

  if(keyLoading) return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#FAF7F2",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",color:"#8B7355"}}>
        <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><HeartIcon size={24}/></div>
        <p style={{fontSize:14}}>Loading…</p>
      </div>
    </div>
  );

  if(!apiKey) return <KeySetupScreen onSave={handleKeySave}/>;

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#FAF7F2",height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Profile Modal */}
      {showProfile && <ProfileModal profile={profile} onSave={handleProfileSave} onClose={()=>setShowProfile(false)}/>}

      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #DDD0BB",padding:"12px 20px",display:"flex",alignItems:"center",gap:14,flexShrink:0}}>
        <div style={{position:"relative",width:48,height:48,flexShrink:0}}>
          <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"2px solid #C0392B",animation:"pulse 2s ease-out infinite",opacity:0}}/>
          <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#6B2D3E,#C0392B)",display:"flex",alignItems:"center",justifyContent:"center"}}><HeartIcon size={24}/></div>
        </div>
        <div>
          <div style={{fontFamily:"Georgia,serif",fontSize:17,fontWeight:600,color:"#2C1810",letterSpacing:"-0.2px"}}>Dr. Cardio</div>
          <div style={{fontSize:12,color:"#8B7355",fontWeight:300,marginTop:1}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"#22C55E",display:"inline-block",marginRight:5,animation:"blink 2s ease-in-out infinite"}}/>
            General Physician & Senior Cardiologist · Sri Lanka
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          {/* Health Profile button */}
          <button onClick={()=>setShowProfile(true)}
            style={{display:"flex",alignItems:"center",gap:5,background:profileFilled?"#6B2D3E":"transparent",border:`1px solid ${profileFilled?"#6B2D3E":"#DDD0BB"}`,borderRadius:20,padding:"5px 12px",cursor:"pointer",color:profileFilled?"#fff":"#8B7355",fontSize:11.5,fontWeight:500,transition:"all 0.2s"}}
            onMouseEnter={e=>{if(!profileFilled){e.currentTarget.style.borderColor="#8B6B4A";e.currentTarget.style.color="#5C4033";}}}
            onMouseLeave={e=>{if(!profileFilled){e.currentTarget.style.borderColor="#DDD0BB";e.currentTarget.style.color="#8B7355";}}}>
            <ProfileIcon/> {profileFilled ? "My Profile ✓" : "My Profile"}
          </button>
          {messages.length > 0 && (
            <button onClick={clearHistory}
              style={{display:"flex",alignItems:"center",gap:5,background:"transparent",border:"1px solid #DDD0BB",borderRadius:20,padding:"5px 10px",cursor:"pointer",color:"#8B7355",fontSize:11,fontWeight:500}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#C0392B";e.currentTarget.style.color="#C0392B";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#DDD0BB";e.currentTarget.style.color="#8B7355";}}>
              <TrashIcon/> New chat
            </button>
          )}
          <button onClick={changeKey} title="Change API key"
            style={{display:"flex",alignItems:"center",gap:4,background:"transparent",border:"1px solid #EEE5D8",borderRadius:20,padding:"5px 10px",cursor:"pointer",color:"#C4A882",fontSize:11}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#8B6B4A";e.currentTarget.style.color="#8B7355";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#EEE5D8";e.currentTarget.style.color="#C4A882";}}>
            <KeyIcon/> <span>Reset key</span>
          </button>
        </div>
      </div>

      {/* ECG Strip */}
      <div style={{height:28,background:"#6B2D3E",flexShrink:0,overflow:"hidden",position:"relative"}}>
        <svg viewBox="0 0 800 28" style={{position:"absolute",height:"100%",width:1600,animation:"ecgScroll 4s linear infinite",opacity:0.6}} xmlns="http://www.w3.org/2000/svg">
          <polyline points="0,14 40,14 50,14 55,4 60,24 65,2 70,26 75,14 80,14 120,14 130,14 135,4 140,24 145,2 150,26 155,14 160,14 200,14 210,14 215,4 220,24 225,2 230,26 235,14 240,14 280,14 290,14 295,4 300,24 305,2 310,26 315,14 320,14 360,14 370,14 375,4 380,24 385,2 390,26 395,14 400,14 440,14 450,14 455,4 460,24 465,2 470,26 475,14 480,14 520,14 530,14 535,4 540,24 545,2 550,26 555,14 560,14 600,14 610,14 615,4 620,24 625,2 630,26 635,14 640,14 680,14 690,14 695,4 700,24 705,2 710,26 715,14 720,14 760,14 770,14 775,4 780,24 785,2 790,26 795,14 800,14"
            fill="none" stroke="rgba(255,200,200,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Messages */}
      <div className="dr-scroll" style={{flex:1,overflowY:"auto",padding:"20px 16px",display:"flex",flexDirection:"column",gap:12}}>

        {/* Disclaimer */}
        <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:12,padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start",flexShrink:0}}>
          <span style={{fontSize:18,lineHeight:1}}>⚕️</span>
          <div style={{fontSize:12.5,color:"#92400E",lineHeight:1.65}}>
            <strong style={{display:"block",marginBottom:3,color:"#78350F",fontSize:13}}>For Educational Purposes Only</strong>
            Dr. Cardio provides general health information and guidance — not medical diagnosis or treatment. Always consult a qualified doctor before making any health decisions. If you feel unwell, have chest pain, difficulty breathing, or any urgent symptom, please visit your nearest hospital or call <strong>1990</strong> (Suwa Seriya) immediately.
          </div>
        </div>

        {/* Profile prompt if empty */}
        {!profileFilled && initialized && (
          <div style={{background:"#F0F9FF",border:"1px solid #BAE6FD",borderRadius:12,padding:"12px 14px",display:"flex",gap:10,alignItems:"center",cursor:"pointer"}} onClick={()=>setShowProfile(true)}>
            <span style={{fontSize:18}}>👤</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:500,color:"#0C4A6E"}}>Set up your Health Profile</div>
              <div style={{fontSize:12,color:"#0369A1",marginTop:2}}>Save your age, conditions & history so Dr. Cardio remembers you every visit.</div>
            </div>
            <span style={{fontSize:12,color:"#0369A1",fontWeight:500,whiteSpace:"nowrap"}}>Set up →</span>
          </div>
        )}

        {grouped.map((item,i) =>
          item.type==='divider'
            ? <DateDivider key={`d-${i}`} label={item.lbl}/>
            : <Message key={`m-${i}`} role={item.role} text={item.text}/>
        )}
        {loading && <TypingDots/>}
        <div ref={messagesEndRef}/>
      </div>

      {/* Emergency Banner */}
      {showEmergency && (
        <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#991B1B",margin:"0 16px 8px",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
          <span>⚠️</span>
          <span>If you are experiencing a medical emergency, call <strong>1990</strong> (Suwa Seriya) or go to your nearest A&E.</span>
        </div>
      )}

      {/* Quick Prompts */}
      {showQuick && initialized && (
        <div style={{padding:"0 16px 8px",display:"flex",gap:8,flexWrap:"wrap",flexShrink:0}}>
          {QUICK_PROMPTS.map((q,i)=>(
            <button key={i} onClick={()=>send(q.msg)}
              style={{background:"#fff",border:"1px solid #DDD0BB",borderRadius:20,padding:"6px 14px",fontFamily:"inherit",fontSize:12.5,color:"#5C4033",cursor:"pointer",whiteSpace:"nowrap"}}
              onMouseEnter={e=>{e.target.style.background="#F5F0E8";e.target.style.borderColor="#8B6B4A";}}
              onMouseLeave={e=>{e.target.style.background="#fff";e.target.style.borderColor="#DDD0BB";}}>
              {q.icon} {q.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{background:"#fff",borderTop:"1px solid #DDD0BB",padding:"12px 16px",flexShrink:0}}>
        <div style={{fontSize:10.5,color:"#8B7355",textAlign:"center",marginBottom:10,lineHeight:1.5}}>
          ⚕️ For educational guidance only · Not a substitute for in-person care · Emergencies: call <strong>1990</strong>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <textarea ref={textareaRef} value={input}
            onChange={e=>{setInput(e.target.value);autoResize(e.target);}}
            onKeyDown={handleKey}
            placeholder="Describe your symptoms or type your report values…"
            disabled={loading} rows={1}
            style={{flex:1,border:"1px solid #DDD0BB",borderRadius:14,padding:"11px 16px",fontFamily:"inherit",fontSize:14,color:"#2C1810",background:loading?"#F5F0E8":"#FAF7F2",resize:"none",outline:"none",lineHeight:1.5,minHeight:44,maxHeight:120,overflowY:"auto"}}
            onFocus={e=>{e.target.style.borderColor="#8B6B4A";e.target.style.background="#fff";}}
            onBlur={e=>{e.target.style.borderColor="#DDD0BB";e.target.style.background="#FAF7F2";}}/>
          <button onClick={()=>send()} disabled={loading||!input.trim()}
            style={{width:44,height:44,borderRadius:"50%",background:loading||!input.trim()?"#C9A48A":"#6B2D3E",border:"none",cursor:loading||!input.trim()?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}
            onMouseEnter={e=>{if(!loading&&input.trim())e.currentTarget.style.background="#C0392B";}}
            onMouseLeave={e=>{if(!loading&&input.trim())e.currentTarget.style.background="#6B2D3E";}}>
            <SendIcon/>
          </button>
        </div>
      </div>
    </div>
  );
}
