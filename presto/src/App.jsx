// ══════════════════════════════════════════════════════════════════════
// SUBNOTE PRESTO — Research Impact Platform
// ══════════════════════════════════════════════════════════════════════
//
// Everyone view (4 tabs): Studies, User Needs, Workflows, Use Case Evaluator
//
// Brand: #7F77DD, Fraunces/DM Sans/DM Mono, dark theme, no emoji
// Tech: Single-file React, all search client-side (no API keys needed)
// ══════════════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect, useRef } from "react";
import { STUDIES_DATA, INSIGHTS_MAP, USER_PROFILES } from "./data.js";

// ── Build STUDY_INDEX for O(1) lookup ──────────────────────────────
const STUDY_INDEX = {};
STUDIES_DATA.forEach(s => { STUDY_INDEX[s.id] = s; });

// Safe JSON parse
const safeParse = (str) => {
  try {
    const cleaned = str.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON parse failed:", e.message, str.slice(0, 200));
    return null;
  }
};

const copyToClipboard = (text) => {
  return new Promise((resolve) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(resolve).catch(() => {
          fallbackCopy(text);
          resolve();
        });
      } else {
        fallbackCopy(text);
        resolve();
      }
    } catch(e) {
      fallbackCopy(text);
      resolve();
    }
  });
};
const fallbackCopy = (text) => {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch(e) {}
  document.body.removeChild(ta);
};

// ── Domain palette ──────────────────────────────────────────────────
const DOMAIN_PALETTE = {
  ENT: { label: "Enterprise & Workplace", color: "#7F77DD", bg: "rgba(127,119,221,0.12)", border: "rgba(127,119,221,0.35)" },
  ENG: { label: "Engineering",            color: "#38bdf8", bg: "rgba(56,189,248,0.12)",  border: "rgba(56,189,248,0.35)"  },
  OPS: { label: "Operations",             color: "#fb923c", bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.35)"  },
  DAT: { label: "Data & Analytics",       color: "#22d3ee", bg: "rgba(34,211,238,0.12)",  border: "rgba(34,211,238,0.35)"  },
  AGT: { label: "Agentic AI",             color: "#a78bfa", bg: "rgba(167,139,250,0.12)", border: "rgba(167,139,250,0.35)" },
  AST: { label: "Assistive AI",           color: "#f472b6", bg: "rgba(244,114,182,0.12)", border: "rgba(244,114,182,0.35)" },
  GOV: { label: "Governance & Ethics",    color: "#fbbf24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.35)"  },
  HLT: { label: "Health & Wellbeing",     color: "#34d399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)"  },
  EDU: { label: "Education",              color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.35)"  },
  CRE: { label: "Creative & Media",       color: "#e879f9", bg: "rgba(232,121,249,0.12)", border: "rgba(232,121,249,0.35)" },
  MKT: { label: "Marketing & Growth",     color: "#fb7185", bg: "rgba(251,113,133,0.12)", border: "rgba(251,113,133,0.35)" },
};

// Dynamic facet derivation — pull only domains that actually appear in studies
const DOMAINS = (() => {
  const used = new Set(STUDIES_DATA.flatMap(s => [s.domain, s.secondaryDomain]).filter(Boolean));
  const result = {};
  for (const key of [...used]) {
    result[key] = DOMAIN_PALETTE[key] || {
      label: key,
      color: "#94a3b8",
      bg: "rgba(148,163,184,0.12)",
      border: "rgba(148,163,184,0.35)",
    };
  }
  return result;
})();
const DOMAIN_KEYS = Object.keys(DOMAINS).sort();

// Set of valid study IDs — used to filter out orphan references
const STUDY_ID_SET = new Set(STUDIES_DATA.map(s => s.id));

// Dynamically extract all user types and themes from studies
const ALL_USERS = [...new Set(STUDIES_DATA.map(s => s.user).filter(Boolean))].sort();
const META_THEMES = [...new Set(STUDIES_DATA.map(s => s.metaTheme).filter(Boolean))].sort();

// USER_PROFILES — clean any studyRefs that point to non-existent studies
const ALL_PROFILES = USER_PROFILES.map(p => ({
  ...p,
  studyRefs: (p.studyRefs || []).filter(ref => STUDY_ID_SET.has(ref)),
}));

// Starter queries relevant to the data.js content
const STARTER_QUERIES = STUDIES_DATA.length > 0
  ? [
      "What happens when users can't tell if AI is right?",
      "How do people build trust with AI tools?",
      "What makes users abandon AI after initial adoption?",
      "How do power users differ from casual users?",
      "What role does transparency play in AI acceptance?",
    ]
  : ["Add the first study to get started."];

// ── Client-side search engine ──────────────────────────────────────
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().split(/\W+/).filter(w => w.length > 2);
}

function scoreStudy(study, queryTokens) {
  const detail = INSIGHTS_MAP[study.id];
  let score = 0;
  const fields = [
    { text: study.title, weight: 5 },
    { text: study.headline, weight: 4 },
    { text: study.user, weight: 3 },
    { text: study.metaTheme, weight: 3 },
    { text: study.domain, weight: 1 },
    { text: detail?.coreProblem, weight: 3 },
    { text: detail?.soWhat, weight: 3 },
  ];
  // Add insight text
  if (detail?.insights) {
    for (const ins of detail.insights) {
      fields.push({ text: ins.title, weight: 2 });
      if (ins.bullets) ins.bullets.forEach(b => fields.push({ text: b, weight: 1 }));
      if (ins.quote?.text) fields.push({ text: ins.quote.text, weight: 1 });
      if (ins.tags) ins.tags.forEach(t => fields.push({ text: t, weight: 2 }));
      if (ins.action) fields.push({ text: ins.action, weight: 1 });
    }
  }
  for (const token of queryTokens) {
    for (const field of fields) {
      if (field.text && field.text.toLowerCase().includes(token)) {
        score += field.weight;
      }
    }
  }
  return score;
}

function clientSearch(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;

  // Score all studies
  const scored = STUDIES_DATA.map(s => ({ study: s, score: scoreStudy(s, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const topStudies = scored.slice(0, 8);
  if (topStudies.length === 0) {
    return {
      summary: "No studies in the library match this query. Try different keywords or browse the study collection directly.",
      soWhat: "",
      stakes: "",
      confidence: "low",
      confidence_rationale: "No matching studies found for this query.",
      insights: [],
      relatedQueries: META_THEMES.slice(0, 3),
    };
  }

  // Collect top matching insights
  const matchedInsights = [];
  for (const { study } of topStudies.slice(0, 5)) {
    const detail = INSIGHTS_MAP[study.id];
    if (!detail?.insights) continue;
    for (const ins of detail.insights) {
      let insScore = 0;
      const insText = [ins.title, ...(ins.bullets || []), ins.action || "", ...(ins.tags || [])].join(" ");
      for (const token of tokens) {
        if (insText.toLowerCase().includes(token)) insScore++;
      }
      if (insScore > 0) {
        matchedInsights.push({ title: ins.title, study: `${study.title} (${study.id})`, score: insScore, studyId: study.id });
      }
    }
  }
  matchedInsights.sort((a, b) => b.score - a.score);

  // Build summary from top study headlines
  const topHeadlines = topStudies.slice(0, 3).map(x => x.study.headline);
  const summary = topHeadlines.join(" Meanwhile, ");

  // Determine confidence
  const confidence = topStudies.length >= 5 ? "high" : topStudies.length >= 2 ? "medium" : "low";

  // Get action and stakes from best match
  const bestDetail = INSIGHTS_MAP[topStudies[0].study.id];
  const soWhat = bestDetail?.soWhat || "";
  const stakes = bestDetail?.stakes || "";

  // Related queries from metaThemes of matching studies
  const relatedThemes = [...new Set(topStudies.map(x => x.study.metaTheme).filter(Boolean))].slice(0, 3);

  return {
    summary,
    soWhat,
    stakes,
    confidence,
    confidence_rationale: `Based on ${topStudies.length} matching studies out of ${STUDIES_DATA.length} total.`,
    insights: matchedInsights.slice(0, 6).map(i => ({ title: i.title, study: i.study })),
    relatedQueries: relatedThemes.length > 0 ? relatedThemes : ["Trust in AI systems", "User onboarding patterns", "Workflow automation"],
  };
}

function clientStudySearch(study, detail, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  const insights = detail?.insights || [];
  const matches = [];
  for (let i = 0; i < insights.length; i++) {
    const ins = insights[i];
    const text = [ins.title, ...(ins.bullets || []), ins.action || "", ...(ins.tags || [])].join(" ");
    let score = 0;
    for (const token of tokens) {
      if (text.toLowerCase().includes(token)) score++;
    }
    if (score > 0) matches.push({ ins, index: i + 1, score });
  }
  matches.sort((a, b) => b.score - a.score);
  if (matches.length === 0) {
    return { answer: "This study doesn't appear to address that topic directly." };
  }
  const top = matches.slice(0, 3);
  const answer = top.map(m => `${m.ins.title} [${m.index}]`).join(". ");
  return { answer };
}

function clientUseCaseEvaluate(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;

  // Score studies
  const scored = STUDIES_DATA.map(s => ({ study: s, score: scoreStudy(s, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const topStudies = scored.slice(0, 5);

  // Score user profile needs/frustrations
  const relatedNeeds = [];
  for (const profile of USER_PROFILES) {
    for (const need of (profile.topNeeds || [])) {
      let nScore = 0;
      for (const token of tokens) {
        if (need.need.toLowerCase().includes(token)) nScore += 2;
      }
      if (nScore > 0) {
        relatedNeeds.push({
          profile_id: profile.id,
          user: profile.title,
          need_text: need.need,
          relevance: `This need was identified across ${need.insightRefs?.length || 0} insights from ${profile.studyRefs?.length || 0} studies.`,
          type: "need",
        });
      }
    }
    for (const frust of (profile.topFrustrations || [])) {
      let fScore = 0;
      for (const token of tokens) {
        if (frust.frustration.toLowerCase().includes(token)) fScore += 2;
      }
      if (fScore > 0) {
        relatedNeeds.push({
          profile_id: profile.id,
          user: profile.title,
          need_text: frust.frustration,
          relevance: `Frustration observed with frequency ${frust.frequency} across studies.`,
          type: "frustration",
        });
      }
    }
  }

  if (topStudies.length === 0) {
    return {
      headline: "The research library doesn't include studies that directly address this use case.",
      human_context: "No studies in the current library cover this specific context. Consider adding relevant research or exploring adjacent topics.",
      what_to_watch_for: [],
      what_makes_it_work: [],
      bottom_line: "No direct research evidence available.",
      confidence: "low",
      confidence_rationale: "No matching studies found.",
      insights: [],
      related_needs: relatedNeeds.slice(0, 3),
    };
  }

  // Build response from best matching studies
  const bestDetail = INSIGHTS_MAP[topStudies[0].study.id];
  const allInsights = topStudies.flatMap(x => {
    const d = INSIGHTS_MAP[x.study.id];
    return (d?.insights || []).map(ins => ({ ...ins, studyId: x.study.id, studyTitle: x.study.title }));
  });

  // Pick best-matching insights
  const insightScores = allInsights.map(ins => {
    let sc = 0;
    const text = [ins.title, ...(ins.bullets || []), ins.action || ""].join(" ");
    for (const token of tokens) {
      if (text.toLowerCase().includes(token)) sc++;
    }
    return { ins, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);

  const topInsights = insightScores.slice(0, 4);

  const headline = bestDetail?.coreProblem
    ? bestDetail.coreProblem.split(".")[0] + "."
    : topStudies[0].study.headline.split(".")[0] + ".";

  const watchFor = topInsights.slice(0, 3).map(x => x.ins.stakes || x.ins.title).filter(Boolean);
  const whatWorks = topInsights.slice(0, 3).map(x => x.ins.action).filter(Boolean);

  const confidence = topStudies.length >= 4 ? "high" : topStudies.length >= 2 ? "medium" : "low";

  return {
    headline,
    human_context: bestDetail?.coreProblem || topStudies[0].study.headline,
    what_to_watch_for: watchFor,
    what_makes_it_work: whatWorks,
    bottom_line: bestDetail?.soWhat || "Consider the human dynamics before the technical implementation.",
    scope_check: `This query touches ${topStudies.length} studies in the library. ${topStudies.length >= 3 ? "Coverage is reasonable." : "Coverage is limited."}`,
    confidence,
    confidence_rationale: `${topStudies.length} studies address this context${topStudies.length < 3 ? " — evidence is indirect for some aspects" : ""}.`,
    insights: topInsights.map(x => ({ title: x.ins.title, study: `${x.ins.studyTitle} (${x.ins.studyId})` })),
    related_needs: relatedNeeds.slice(0, 4),
  };
}


const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,700;0,9..144,900;1,9..144,400&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #1E2025;
    position: relative;
  }
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      linear-gradient(rgba(0,212,180,0.015) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,212,180,0.015) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
    z-index: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1;box-shadow:0 0 6px currentColor;} 50%{opacity:0.5;box-shadow:none;} }
  @keyframes fadeUp { from{opacity:0;transform:translateY(10px);} to{opacity:1;transform:none;} }
  @keyframes shimmer { from{background-position:-200% 0;} to{background-position:200% 0;} }
  ::-webkit-scrollbar{width:5px;} ::-webkit-scrollbar-track{background:transparent;} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px;}
  input::placeholder{color:rgba(255,255,255,0.22);}
  ::selection{background:rgba(127,119,221,0.3);}
  button:focus-visible{outline:2px solid #7F77DD;outline-offset:2px;}
  input:focus-visible{outline:2px solid #7F77DD;outline-offset:0px;}
  button{font-family:inherit;cursor:pointer;}
  button:hover{filter:brightness(1.15);}
  button:active{transform:scale(0.98);}
`;

// ── Rich Insight Tooltip ────────────────────────────────────────
function InsightTip({ insightId, children }) {
  const [show, setShow] = useState(false);
  const [mousePos, setMousePos] = useState({ x:0, y:0 });
  const tipRef = useRef(null);

  const studyId = insightId?.split("-").slice(0,2).join("-");
  const detail = studyId ? INSIGHTS_MAP[studyId] : null;
  const insight = detail?.insights?.find(i => i.id === insightId);
  const study = studyId ? STUDY_INDEX[studyId] : null;

  useEffect(() => {
    if (!show || !tipRef.current) return;
    const el = tipRef.current;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let x = mousePos.x + 14;
    let y = mousePos.y - 14;
    if (x + tw > window.innerWidth - 8) x = mousePos.x - tw - 14;
    if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
    if (y < 8) y = 8;
    el.style.left = x + "px";
    el.style.top = y + "px";
  }, [show, mousePos]);

  if (!insight) return children;
  const domainColor = study?.domain ? (DOMAINS[study.domain]?.color || "#7F77DD") : "#7F77DD";

  return (
    <div onMouseEnter={()=>setShow(true)} onMouseMove={e=>setMousePos({x:e.clientX,y:e.clientY})} onMouseLeave={()=>setShow(false)}>
      {children}
      {show && (
        <div ref={tipRef} style={{ position:"fixed",left:0,top:0,zIndex:9999,pointerEvents:"none",background:"#1a1c22",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:0,maxWidth:360,minWidth:280,boxShadow:"0 12px 40px rgba(0,0,0,0.6)",animation:"fadeUp 0.12s ease",overflow:"hidden" }}>
          <div style={{ height:3,background:`linear-gradient(90deg,${domainColor},transparent)` }}/>
          <div style={{ padding:"14px 16px" }}>
            <div style={{ fontSize:10,color:domainColor,fontFamily:"'DM Mono',monospace",letterSpacing:"0.04em",marginBottom:8 }}>{insightId}</div>
            <div style={{ fontSize:13.5,fontWeight:700,color:"#f0f4ff",fontFamily:"'Fraunces',serif",lineHeight:1.35,marginBottom:10 }}>{insight.title}</div>
            {insight.bullets?.length > 0 && (
              <div style={{ display:"flex",flexDirection:"column",gap:4,marginBottom:10 }}>
                {insight.bullets.slice(0, 3).map((b, i) => (
                  <div key={i} style={{ display:"flex",gap:8,fontSize:11.5,color:"rgba(255,255,255,0.7)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.45 }}>
                    <span style={{ color:"rgba(255,255,255,0.25)",flexShrink:0 }}>{"\u2014"}</span>
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            )}
            {insight.action && (
              <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,padding:"8px 10px" }}>
                <div style={{ fontSize:9,color:"rgba(255,255,255,0.45)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:4 }}>Action</div>
                <div style={{ fontSize:11.5,color:"rgba(255,255,255,0.8)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.45 }}>{insight.action}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Primitives ──────────────────────────────────────────────────────
function DomainPill({ code, small }) {
  const d = DOMAINS[code]; if (!d) return null;
  return <span style={{ display:"inline-flex",alignItems:"center",background:d.bg,border:`1px solid ${d.border}`,color:d.color,borderRadius:4,padding:small?"2px 8px":"3px 10px",fontSize:small?10:11,fontFamily:"'DM Mono',monospace",fontWeight:500,letterSpacing:"0.04em",textTransform:"uppercase",whiteSpace:"nowrap" }}>{d.label}</span>;
}
function Tag({ label, color }) {
  return <span style={{ background:color?"rgba(127,119,221,0.1)":"rgba(255,255,255,0.06)",border:`1px solid ${color?"rgba(127,119,221,0.25)":"rgba(255,255,255,0.1)"}`,color:color||"rgba(255,255,255,0.45)",borderRadius:3,padding:"2px 8px",fontSize:10,fontFamily:"'DM Mono',monospace",letterSpacing:"0.03em",whiteSpace:"nowrap" }}>{label}</span>;
}

function ConfidenceBadge({ level, rationale }) {
  const [showTip, setShowTip] = useState(false);
  const ref = useRef(null);
  const colors = { high:"#34d399", medium:"#fbbf24", low:"#f87171" };
  const labels = { high:"High confidence", medium:"Medium confidence", low:"Low confidence" };
  const c = colors[(level||"medium").toLowerCase()] || colors.medium;
  const l = labels[(level||"medium").toLowerCase()] || labels.medium;

  const getTipStyle = () => {
    if (!ref.current) return {};
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const tipW = 320;
    const above = spaceBelow < 180;
    return {
      position:"fixed",
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.min(rect.left, window.innerWidth - tipW - 16),
      transform: above ? "translateY(-100%)" : "none",
      width: tipW,
    };
  };

  return (
    <div ref={ref} style={{ position:"relative", display:"inline-flex" }} onMouseEnter={()=>setShowTip(true)} onMouseLeave={()=>setShowTip(false)}>
      <div style={{ display:"flex", alignItems:"center", gap:6, background:`${c}11`, border:`1px solid ${c}33`, borderRadius:6, padding:"3px 10px 3px 7px", cursor:"default" }}>
        <div style={{ width:7, height:7, borderRadius:"50%", background:c, flexShrink:0 }}/>
        <span style={{ fontSize:10.5, color:c, fontFamily:"'DM Mono',monospace", letterSpacing:"0.04em", whiteSpace:"nowrap" }}>{l}</span>
      </div>
      {showTip && rationale && (
        <div style={{ ...getTipStyle(), background:"#252830", border:`1px solid ${c}33`, borderRadius:8, padding:"12px 14px", zIndex:1000, boxShadow:"0 12px 40px rgba(0,0,0,0.6)", animation:"fadeUp 0.12s ease" }}>
          <div style={{ fontSize:9.5, color:c, fontFamily:"'DM Mono',monospace", letterSpacing:"0.06em", textTransform:"uppercase", marginBottom:6 }}>Why this confidence level</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.9)", fontFamily:"'DM Sans',sans-serif", lineHeight:1.55 }}>{rationale}</div>
        </div>
      )}
    </div>
  );
}

// ── Study Card ──────────────────────────────────────────────────────
function StudyCard({ study, onClick }) {
  const d = DOMAINS[study.domain] || { color:"#7F77DD", bg:"rgba(127,119,221,0.12)", border:"rgba(127,119,221,0.35)" };
  const [hov, setHov] = useState(false);
  return (
    <div onClick={()=>onClick(study)} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ background:hov?"#1e2026":"#252830",border:`1px solid ${hov?d.border:"rgba(255,255,255,0.07)"}`,borderRadius:10,padding:"22px 24px 20px",cursor:"pointer",transition:"all 0.18s ease",transform:hov?"translateY(-2px)":"none",boxShadow:hov?`0 8px 32px rgba(0,0,0,0.4),0 0 0 1px ${d.border}`:"none",display:"flex",flexDirection:"column",gap:12,position:"relative",overflow:"hidden",animation:"fadeUp 0.3s ease both" }}>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:hov?d.color:"transparent",transition:"background 0.18s ease" }}/>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10 }}>
        <DomainPill code={study.domain} small />
        <span style={{ fontSize:10,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.04em",whiteSpace:"nowrap" }}>{study.id}</span>
      </div>
      <div style={{ fontSize:15,fontWeight:700,color:"#f0f4ff",fontFamily:"'Fraunces',serif",lineHeight:1.25,letterSpacing:"-0.01em" }}>{study.title}</div>
      <div style={{ fontSize:12.5,color:"rgba(255,255,255,0.58)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif",flexGrow:1 }}>{study.headline}</div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:12,gap:8,flexWrap:"wrap" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <span style={{ fontSize:10.5,color:"rgba(255,255,255,0.85)",fontFamily:"'DM Sans',sans-serif" }}>{study.user}</span>
        </div>
      </div>
    </div>
  );
}

// ── Filter Pill ─────────────────────────────────────────────────────
function FilterPill({ label, active, color, onClick }) {
  return <button onClick={onClick} style={{ background:active?(color?`${color}22`:"rgba(255,255,255,0.12)"):"rgba(255,255,255,0.04)",border:`1px solid ${active?(color||"rgba(255,255,255,0.4)"):"rgba(255,255,255,0.1)"}`,color:active?(color||"#fff"):"rgba(255,255,255,0.42)",borderRadius:6,padding:"5px 13px",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:500,transition:"all 0.15s ease",whiteSpace:"nowrap" }}>{label}</button>;
}

// ── Search Bar ──────────────────────────────────────────────────────
function SearchBar({ value, onChange, onSubmit, loading }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position:"relative",filter:focused?"drop-shadow(0 0 24px rgba(127,119,221,0.22))":"none",transition:"filter 0.3s ease" }}>
      <input value={value} onChange={e=>onChange(e.target.value)} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} onKeyDown={e=>e.key==="Enter"&&onSubmit()}
        placeholder="Find an insight..." aria-label="Search the research library"
        style={{ width:"100%",background:"#252830",border:`1.5px solid ${focused?"#7F77DD":"rgba(255,255,255,0.1)"}`,borderRadius:12,padding:"18px 60px 18px 22px",fontSize:16,color:"#f0f4ff",fontFamily:"'DM Sans',sans-serif",outline:"none",transition:"border-color 0.2s ease",caretColor:"#7F77DD" }}/>
      <button onClick={onSubmit} style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:loading?"rgba(127,119,221,0.3)":"#7F77DD",border:"none",borderRadius:8,width:36,height:36,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"background 0.2s ease" }}>
        {loading?<div style={{ width:14,height:14,border:"2px solid rgba(255,255,255,0.4)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin 0.8s linear infinite" }}/>:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>}
      </button>
    </div>
  );
}

// ── AI Result Panel ─────────────────────────────────────────────────
function AIResultPanel({ result, onClose, onQueryClick, onStudyClick }) {
  const [hoveredIns, setHoveredIns] = useState(null);
  const [hoverPos, setHoverPos] = useState({x:0,y:0});

  if (!result) return null;

  const findStudyId = (studyRef) => {
    const m = studyRef.match(/\(([A-Z]+-\d+)\)/);
    return m ? m[1] : null;
  };
  const findStudy = (studyRef) => {
    const id = findStudyId(studyRef);
    return id ? (STUDY_INDEX[id] || null) : null;
  };
  const findInsight = (studyRef, aiTitle) => {
    const id = findStudyId(studyRef);
    if (!id || !INSIGHTS_MAP[id]) return null;
    const insights = INSIGHTS_MAP[id].insights || [];
    if (!insights.length) return null;
    const aiWords = new Set(aiTitle.toLowerCase().split(/\W+/).filter(w=>w.length>3));
    let best = insights[0], bestScore = 0;
    for (const ins of insights) {
      const score = ins.title.toLowerCase().split(/\W+/).filter(w=>aiWords.has(w)).length;
      if (score > bestScore) { bestScore = score; best = ins; }
    }
    return { ...best, studyId: id, studyDomain: STUDY_INDEX[id]?.domain };
  };

  return (
    <div style={{ background:"#252830",border:"1px solid rgba(127,119,221,0.25)",borderRadius:12,padding:"22px 24px 20px",marginBottom:28,position:"relative",animation:"fadeUp 0.3s ease" }}>
      <div style={{ background:"rgba(127,119,221,0.08)",border:"1px solid rgba(127,119,221,0.15)",borderRadius:6,padding:"8px 12px",marginBottom:14,fontSize:11,color:"rgba(255,255,255,0.45)",fontFamily:"'DM Mono',monospace",lineHeight:1.5 }}>
        This is a demo with client-side keyword matching — not a live AI synthesis. In production, results are generated by Claude and are significantly more nuanced.
      </div>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <div style={{ width:7,height:7,borderRadius:"50%",background:"#7F77DD" }}/>
            <span style={{ fontSize:10,color:"#7F77DD",fontFamily:"'DM Mono',monospace",letterSpacing:"0.1em",textTransform:"uppercase" }}>Research Synthesis</span>
          </div>
          {result.confidence && <ConfidenceBadge level={result.confidence} rationale={result.confidence_rationale}/>}
        </div>
        <button onClick={onClose} style={{ background:"none",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",fontSize:18,lineHeight:1,padding:"0 4px" }}>{"\u00D7"}</button>
      </div>
      <p style={{ fontSize:15,color:"#f0f4ff",lineHeight:1.6,fontFamily:"'DM Sans',sans-serif",fontWeight:400,marginBottom:16 }}>{result.summary}</p>
      {(result.soWhat||result.stakes)&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18 }}>
          {result.soWhat&&(
            <div style={{ background:"rgba(127,119,221,0.07)",border:"1px solid rgba(127,119,221,0.22)",borderRadius:8,padding:"12px 14px",position:"relative",overflow:"hidden" }}>
              <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#7F77DD,#AFA9EC)" }}/>
              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:7 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7F77DD" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span style={{ fontSize:9.5,color:"#7F77DD",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase" }}>Action</span>
              </div>
              <p style={{ fontSize:12.5,color:"rgba(255,255,255,0.92)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif",margin:0 }}>{result.soWhat}</p>
            </div>
          )}
          {result.stakes&&(
            <div style={{ background:"rgba(251,191,36,0.06)",border:"1px solid rgba(251,191,36,0.22)",borderRadius:8,padding:"12px 14px",position:"relative",overflow:"hidden" }}>
              <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#f59e0b,#f87171)" }}/>
              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:7 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span style={{ fontSize:9.5,color:"#f59e0b",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase" }}>What's at Stake</span>
              </div>
              <p style={{ fontSize:12.5,color:"rgba(255,255,255,0.92)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif",margin:0 }}>{result.stakes}</p>
            </div>
          )}
        </div>
      )}
      {result.insights?.length>0&&(
        <div style={{ marginBottom:16,position:"relative" }}>
          <div style={{ height:"1px",background:"rgba(255,255,255,0.07)",marginBottom:14 }}/>
          <div style={{ fontSize:9.5,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10 }}>Supporting Insights</div>
          <div style={{ display:"flex",flexDirection:"column",gap:0 }}>
            {result.insights.map((ins,i)=>{
              const study = findStudy(ins.study);
              const d = study ? DOMAINS[study.domain] : null;
              const realIns = findInsight(ins.study, ins.title);
              const displayTitle = realIns?.title || ins.title;
              return (
                <div key={i}
                  onClick={study ? ()=>onStudyClick(study) : undefined}
                  onMouseEnter={e=>{ setHoveredIns(realIns); setHoverPos({x:e.clientX,y:e.clientY}); }}
                  onMouseMove={e=>setHoverPos({x:e.clientX,y:e.clientY})}
                  onMouseLeave={()=>setHoveredIns(null)}
                  style={{ display:"flex",alignItems:"center",gap:14,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,0.05)",cursor:study?"pointer":"default",transition:"background 0.12s ease" }}
                >
                  <span style={{ fontSize:11,color:"rgba(255,255,255,0.55)",fontFamily:"'DM Mono',monospace",minWidth:16,flexShrink:0 }}>{i+1}</span>
                  <div style={{ flex:1,minWidth:0 }}>
                    <span style={{ fontSize:12.5,color:"rgba(255,255,255,0.85)",fontFamily:"'DM Sans',sans-serif",fontWeight:500,lineHeight:1.35 }}>{displayTitle}</span>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                    {d&&<span style={{ width:6,height:6,borderRadius:"50%",background:d.color,display:"inline-block",flexShrink:0 }}/>}
                    <span style={{ fontSize:10,color:study?"rgba(255,255,255,0.4)":"rgba(255,255,255,0.22)",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap" }}>{findStudyId(ins.study)||ins.study}</span>
                    {study&&<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>}
                  </div>
                </div>
              );
            })}
          </div>
          {hoveredIns&&(()=>{
            const d = DOMAINS[hoveredIns.studyDomain];
            const dColor = d?.color||"#7F77DD";
            const cardW = 380;
            const left = hoverPos.x+16+cardW>window.innerWidth ? hoverPos.x-cardW-16 : hoverPos.x+16;
            const top = Math.min(hoverPos.y-20, window.innerHeight-420);
            return (
              <div style={{ position:"fixed",top,left,width:cardW,background:"#252830",border:`1px solid ${dColor}44`,borderRadius:10,overflow:"hidden",zIndex:1000,boxShadow:"0 20px 60px rgba(0,0,0,0.7)",pointerEvents:"none",animation:"fadeUp 0.1s ease" }}>
                <div style={{ height:3,background:`linear-gradient(90deg,${dColor},transparent)` }}/>
                <div style={{ padding:"16px 18px" }}>
                  <div style={{ fontSize:9.5,color:dColor,fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8 }}>{hoveredIns.studyId}</div>
                  <p style={{ fontSize:13.5,fontWeight:700,color:"#f0f4ff",fontFamily:"'Fraunces',serif",lineHeight:1.35,letterSpacing:"-0.01em",marginBottom:12 }}>{hoveredIns.title}</p>
                  <ul style={{ listStyle:"none",display:"flex",flexDirection:"column",gap:7,marginBottom:14 }}>
                    {hoveredIns.bullets?.slice(0,3).map((b,i)=>(
                      <li key={i} style={{ display:"flex",gap:8,alignItems:"flex-start" }}>
                        <span style={{ color:dColor,fontSize:12,lineHeight:1.4,flexShrink:0 }}>{"\u2014"}</span>
                        <span style={{ fontSize:12,color:"rgba(255,255,255,0.62)",lineHeight:1.5,fontFamily:"'DM Sans',sans-serif" }}>{b}</span>
                      </li>
                    ))}
                  </ul>
                  {hoveredIns.action&&(
                    <div style={{ background:"rgba(255,255,255,0.04)",borderRadius:6,padding:"10px 12px" }}>
                      <div style={{ fontSize:9,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:5 }}>Action</div>
                      <p style={{ fontSize:12,color:"rgba(255,255,255,0.68)",lineHeight:1.5,fontFamily:"'DM Sans',sans-serif",margin:0 }}>{hoveredIns.action}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
      {result.relatedQueries?.length>0&&(
        <div style={{ display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
          <span style={{ fontSize:10,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0 }}>Also ask</span>
          {result.relatedQueries.map((q,i)=>(
            <span key={i} onClick={()=>onQueryClick(q)} style={{ background:"rgba(127,119,221,0.08)",border:"1px solid rgba(127,119,221,0.2)",color:"rgba(127,119,221,0.8)",borderRadius:20,padding:"4px 12px",fontSize:11.5,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",transition:"all 0.15s ease" }}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(127,119,221,0.15)";e.currentTarget.style.color="#7F77DD";}}
              onMouseLeave={e=>{e.currentTarget.style.background="rgba(127,119,221,0.08)";e.currentTarget.style.color="rgba(127,119,221,0.8)";}}
            >{q}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Insight Card ────────────────────────────────────────────────────
function InsightCard({ insight, domainColor, index }) {
  const [copied, setCopied] = useState(false);

  const copyText = () => {
    const text = [
      insight.title, "",
      insight.bullets.map(b=>`- ${b}`).join("\n"), "",
      `ACTION: ${insight.action}`, "",
      `STAKES: ${insight.stakes}`,
      insight.quote ? `\n"${insight.quote.text}" -- ${insight.quote.attr}` : ""
    ].join("\n");
    copyToClipboard(text).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); });
  };

  return (
    <div style={{ background:"#252830",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,overflow:"hidden",animation:`fadeUp 0.3s ease ${index*0.05}s both` }}>
      <div style={{ height:3,background:`linear-gradient(90deg,${domainColor},transparent)` }}/>
      <div style={{ padding:"20px 22px" }}>
        <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:14 }}>
          <h3 style={{ fontSize:14.5,fontWeight:700,color:"#f0f4ff",fontFamily:"'Fraunces',serif",lineHeight:1.3,letterSpacing:"-0.01em",flex:1 }}>{insight.title}</h3>
          <button onClick={copyText} style={{ background:copied?"rgba(52,211,153,0.15)":"rgba(255,255,255,0.06)",border:`1px solid ${copied?"rgba(52,211,153,0.4)":"rgba(255,255,255,0.1)"}`,color:copied?"#34d399":"rgba(255,255,255,0.4)",borderRadius:6,padding:"5px 10px",fontSize:10.5,cursor:"pointer",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap",transition:"all 0.2s ease",flexShrink:0 }}>
            {copied?"Copied":"Copy"}
          </button>
        </div>
        <ul style={{ listStyle:"none",display:"flex",flexDirection:"column",gap:8,marginBottom:16 }}>
          {insight.bullets.map((b,i)=>(
            <li key={i} style={{ display:"flex",gap:10,alignItems:"flex-start" }}>
              <span style={{ color:domainColor,fontSize:14,lineHeight:1.4,flexShrink:0,marginTop:1 }}>{"\u2014"}</span>
              <span style={{ fontSize:13,color:"rgba(255,255,255,0.68)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif" }}>{b}</span>
            </li>
          ))}
        </ul>
        <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,padding:"12px 14px",marginBottom:12 }}>
          <div style={{ fontSize:9.5,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6 }}>Action</div>
          <p style={{ fontSize:12.5,color:"rgba(255,255,255,0.92)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif" }}>{insight.action}</p>
        </div>
        <div style={{ background:`${domainColor}0d`,border:`1px solid ${domainColor}33`,borderRadius:8,padding:"12px 14px",marginBottom:insight.quote?14:0 }}>
          <div style={{ fontSize:9.5,color:domainColor,fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6 }}>Stakes</div>
          <p style={{ fontSize:12.5,color:"rgba(255,255,255,0.92)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif" }}>{insight.stakes}</p>
        </div>
        {insight.quote&&(
          <div style={{ borderLeft:`2px solid ${domainColor}`,paddingLeft:14,marginTop:14 }}>
            <p style={{ fontSize:13,color:"rgba(255,255,255,0.9)",lineHeight:1.6,fontStyle:"italic",fontFamily:"'Fraunces',serif",marginBottom:6 }}>"{insight.quote.text}"</p>
            <p style={{ fontSize:10.5,color:"rgba(255,255,255,0.8)",fontFamily:"'DM Mono',monospace" }}>{insight.quote.attr}</p>
          </div>
        )}
        {insight.tags?.length>0&&(
          <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginTop:16 }}>
            {insight.tags.map((t,i)=><Tag key={i} label={t}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Survey Insight Card ─────────────────────────────────────────
function SurveyInsightCard({ insight, domainColor, index }) {
  const [copied, setCopied] = useState(false);
  const [expandedSeg, setExpandedSeg] = useState(0);

  const copyText = () => {
    const lines = [insight.title, ""];
    if (insight.metrics) insight.metrics.forEach(m => lines.push(`${m.label}: ${formatMetric(m)}`));
    lines.push("", `ACTION: ${insight.action}`, `STAKES: ${insight.stakes}`);
    copyToClipboard(lines.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const formatMetric = (m) => {
    if (m.format === "nps") return `${m.value > 0 ? "+" : ""}${m.value}`;
    if (m.format === "pct" || m.format === "pct_requested" || m.format === "pct_trust_avg" || m.format === "pct_open_rate" || m.format === "pct_completed" || m.format === "pct_trust" || m.format === "pct_missed_urgent") return `${m.value}%`;
    if (m.format === "rating5") return `${m.value} / 5`;
    if (m.format === "hours" || m.format === "hours_deep_work") return `${m.value}h`;
    return `${m.value}`;
  };

  const metricColor = (m) => {
    if (m.highlight === true) return "#34d399";
    if (m.highlight === "negative") return "#f87171";
    return "rgba(255,255,255,0.9)";
  };

  const barColor = (b) => {
    if (b.highlight === true) return "#34d399";
    if (b.highlight === "negative") return "#f87171";
    return domainColor;
  };

  return (
    <div style={{ background:"#252830",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,overflow:"hidden",animation:`fadeUp 0.3s ease ${index*0.05}s both` }}>
      <div style={{ height:3,background:`linear-gradient(90deg,${domainColor},transparent)` }}/>
      <div style={{ padding:"20px 22px" }}>
        <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:16 }}>
          <h3 style={{ fontSize:14.5,fontWeight:700,color:"#f0f4ff",fontFamily:"'Fraunces',serif",lineHeight:1.3,letterSpacing:"-0.01em",flex:1 }}>{insight.title}</h3>
          <button onClick={copyText} style={{ background:copied?"rgba(52,211,153,0.15)":"rgba(255,255,255,0.06)",border:`1px solid ${copied?"rgba(52,211,153,0.4)":"rgba(255,255,255,0.1)"}`,color:copied?"#34d399":"rgba(255,255,255,0.4)",borderRadius:6,padding:"5px 10px",fontSize:10.5,cursor:"pointer",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap",transition:"all 0.2s ease",flexShrink:0 }}>
            {copied?"Copied":"Copy"}
          </button>
        </div>
        {insight.metrics?.length > 0 && (
          <div style={{ display:"grid",gridTemplateColumns:`repeat(${Math.min(insight.metrics.length, 3)},1fr)`,gap:10,marginBottom:16 }}>
            {insight.metrics.map((m, mi) => (
              <div key={mi} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,padding:"12px 14px" }}>
                <div style={{ fontSize:24,fontWeight:900,color:metricColor(m),fontFamily:"'Fraunces',serif",letterSpacing:"-0.02em" }}>{formatMetric(m)}</div>
                <div style={{ fontSize:11,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.3,marginTop:4 }}>{m.label}</div>
                <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:6 }}>
                  <span style={{ fontSize:9.5,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace" }}>n={m.n}</span>
                  {m.context && <span style={{ fontSize:9.5,color:"rgba(255,255,255,0.4)",fontFamily:"'DM Sans',sans-serif" }}>{m.context}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {insight.segments?.length > 0 && (
          <div style={{ marginBottom:16 }}>
            {insight.segments.length > 1 && (
              <div style={{ display:"flex",gap:0,background:"rgba(255,255,255,0.04)",borderRadius:6,border:"1px solid rgba(255,255,255,0.08)",overflow:"hidden",width:"fit-content",marginBottom:12 }}>
                {insight.segments.map((seg, si) => (
                  <button key={si} onClick={()=>setExpandedSeg(si)}
                    style={{ padding:"5px 14px",fontSize:10.5,color:expandedSeg===si?domainColor:"rgba(255,255,255,0.4)",background:expandedSeg===si?`${domainColor}12`:"none",border:"none",borderRight:"1px solid rgba(255,255,255,0.06)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:500,transition:"all 0.12s ease" }}>{seg.dimension}</button>
                ))}
              </div>
            )}
            {(()=>{
              const seg = insight.segments[expandedSeg] || insight.segments[0];
              if (!seg) return null;
              const maxVal = Math.max(...seg.breakdowns.map(b => typeof b.value === "number" ? Math.abs(b.value) : 0), 1);
              return (
                <div style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,padding:"14px 16px" }}>
                  <div style={{ fontSize:9.5,color:"rgba(255,255,255,0.5)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:12 }}>{seg.dimension}</div>
                  {seg.breakdowns.map((b, bi) => {
                    const pct = Math.abs(b.value) / maxVal * 100;
                    return (
                      <div key={bi} style={{ display:"flex",alignItems:"center",gap:12,marginBottom:8 }}>
                        <div style={{ width:180,flexShrink:0,fontSize:12,color:"rgba(255,255,255,0.85)",fontFamily:"'DM Sans',sans-serif",lineHeight:1.3,textAlign:"right" }}>{b.label}</div>
                        <div style={{ flex:1,height:20,background:"rgba(255,255,255,0.04)",borderRadius:3,overflow:"hidden",position:"relative" }}>
                          <div style={{ height:"100%",width:`${Math.min(pct, 100)}%`,background:barColor(b),borderRadius:3,transition:"width 0.6s ease" }}/>
                        </div>
                        <div style={{ width:64,flexShrink:0,fontSize:11,color:metricColor(b),fontFamily:"'DM Mono',monospace",textAlign:"right",fontWeight:b.highlight?600:400 }}>{formatMetric(b)}</div>
                        {b.n && <span style={{ fontSize:9,color:"rgba(255,255,255,0.25)",fontFamily:"'DM Mono',monospace",width:40,textAlign:"right",flexShrink:0 }}>n={b.n}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}
        {insight.openEnded?.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:9.5,color:"rgba(255,255,255,0.5)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10 }}>Open-Ended Themes</div>
            <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
              {insight.openEnded.map((theme, ti) => (
                <div key={ti} style={{ background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,padding:"12px 14px" }}>
                  <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}>
                    <span style={{ fontSize:12.5,fontWeight:600,color:"rgba(255,255,255,0.9)",fontFamily:"'DM Sans',sans-serif" }}>{theme.theme}</span>
                    <div style={{ display:"flex",gap:8 }}>
                      <span style={{ fontSize:10,color:domainColor,fontFamily:"'DM Mono',monospace" }}>{theme.pct}%</span>
                      <span style={{ fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace" }}>{theme.count} mentions</span>
                    </div>
                  </div>
                  {theme.sampleQuotes?.map((q, qi) => (
                    <div key={qi} style={{ borderLeft:`2px solid ${domainColor}33`,paddingLeft:12,marginTop:8 }}>
                      <p style={{ fontSize:12,color:"rgba(255,255,255,0.7)",lineHeight:1.5,fontStyle:"italic",fontFamily:"'Fraunces',serif",margin:0 }}>"{q}"</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,padding:"12px 14px",marginBottom:12 }}>
          <div style={{ fontSize:9.5,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6 }}>Action</div>
          <p style={{ fontSize:12.5,color:"rgba(255,255,255,0.92)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif" }}>{insight.action}</p>
        </div>
        <div style={{ background:`${domainColor}0d`,border:`1px solid ${domainColor}33`,borderRadius:8,padding:"12px 14px" }}>
          <div style={{ fontSize:9.5,color:domainColor,fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6 }}>Stakes</div>
          <p style={{ fontSize:12.5,color:"rgba(255,255,255,0.92)",lineHeight:1.55,fontFamily:"'DM Sans',sans-serif" }}>{insight.stakes}</p>
        </div>
        {insight.tags?.length > 0 && (
          <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginTop:16 }}>
            {insight.tags.map((t,i)=><Tag key={i} label={t}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Study Local Search (client-side) ──────────────────────────────
function StudyLocalSearch({ study, detail, domainColor }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hovFootnote, setHovFootnote] = useState(null);
  const fnRefs = useRef({});
  const insights = detail.insights || [];

  const ask = () => {
    if (!q.trim()) return;
    setLoading(true); setAnswer(null);
    setTimeout(() => {
      const result = clientStudySearch(study, detail, q);
      setAnswer(result);
      setLoading(false);
    }, 300);
  };

  const renderAnswer = (text) => {
    const parts = [];
    const regex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    let lastIdx = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) parts.push({ type: "text", value: text.slice(lastIdx, match.index) });
      const nums = match[1].split(/\s*,\s*/).map(n => parseInt(n));
      nums.forEach(num => parts.push({ type: "fn", num }));
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) parts.push({ type: "text", value: text.slice(lastIdx) });

    return parts.map((p, i) => {
      if (p.type === "text") return <span key={i}>{p.value}</span>;
      const ins = insights[p.num - 1];
      if (!ins) return <sup key={i} style={{ color: domainColor, fontSize: 10 }}>[{p.num}]</sup>;
      return (
        <sup key={i}
          ref={el => fnRefs.current[p.num] = el}
          onMouseEnter={() => setHovFootnote(p.num)}
          onMouseLeave={() => setHovFootnote(null)}
          style={{ color: domainColor, fontSize: 10, cursor: "default", fontWeight: 700, position: "relative" }}
        >
          [{p.num}]
          {hovFootnote === p.num && (
            <span style={{
              position: "fixed",
              top: fnRefs.current[p.num] ? fnRefs.current[p.num].getBoundingClientRect().bottom + 8 : 0,
              left: fnRefs.current[p.num] ? Math.min(fnRefs.current[p.num].getBoundingClientRect().left, window.innerWidth - 340) : 0,
              width: 320, background: "#252830", border: `1px solid ${domainColor}44`, borderRadius: 8, padding: "12px 14px",
              zIndex: 1000, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", pointerEvents: "none",
              display: "block", fontWeight: 400, fontSize: 12, lineHeight: "1.5", textTransform: "none", letterSpacing: "normal",
            }}>
              <span style={{ display: "block", fontSize: 9.5, color: domainColor, fontFamily: "'DM Mono',monospace", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Insight {p.num}</span>
              <span style={{ display: "block", fontSize: 13, color: "#f0f4ff", fontFamily: "'Fraunces',serif", fontWeight: 600, lineHeight: 1.35, marginBottom: 8 }}>{ins.title}</span>
              {ins.bullets?.[0] && <span style={{ display: "block", fontSize: 11.5, color: "rgba(255,255,255,0.9)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.5 }}>{ins.bullets[0]}</span>}
            </span>
          )}
        </sup>
      );
    });
  };

  return (
    <div style={{ background: "#252830", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "16px 20px", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: answer || loading ? 14 : 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={domainColor} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") ask(); }}
          placeholder="Ask a question about this study..."
          style={{ flex: 1, background: "transparent", border: "none", color: "#f0f4ff", fontSize: 13.5, fontFamily: "'DM Sans',sans-serif", outline: "none", caretColor: domainColor }}
        />
        {q.trim() && (
          <button onClick={ask} disabled={loading}
            style={{ background: domainColor, color: "#1E2025", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 11.5, fontWeight: 600, cursor: loading ? "default" : "pointer", fontFamily: "'DM Sans',sans-serif", opacity: loading ? 0.5 : 1 }}
          >{loading ? "..." : "Ask"}</button>
        )}
      </div>
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
          <div style={{ display: "flex", gap: 4 }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: domainColor, animation: `pulse 1.2s ${i * 0.2}s infinite` }}/>)}</div>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: "'DM Sans',sans-serif" }}>Searching this study...</span>
        </div>
      )}
      {answer && (
        <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.8)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.65 }}>
          {renderAnswer(answer.answer)}
        </div>
      )}
    </div>
  );
}

// ── Patterns View ─────────────────────────────────────────────
function PatternsView({ study, detail, domainColor }) {
  const insights = detail.insights || [];
  let _s = 0;
  for (let i = 0; i < study.id.length; i++) { _s = ((_s << 5) - _s) + study.id.charCodeAt(i); _s |= 0; }
  _s = Math.abs(_s);
  const r = (min, max) => { _s = (_s * 16807 + 0) % 2147483647; return Math.round(min + ((_s - 1) / 2147483646) * (max - min)); };

  const codebook = {
    "Trust":["Conditional trust","Trust calibration","Selective trust","Trust threshold","Trust fragility","Trust ceiling"],
    "Trust Gap":["Trust erosion","Trust deficit","Broken trust cycle","Confidence gap","Trust withdrawal","Credibility loss"],
    "Mental Model":["Expectation gap","Mental model drift","Cognitive frame mismatch","Understanding gap","Model mismatch"],
    "Mental Model Problem":["Flawed expectations","Misread capability signals","Assumption error","Expectation violation","False model"],
    "Transparency Imperative":["Opacity frustration","Visibility gap","Signal absence","Explanation deficit","Black box anxiety","Legibility gap"],
    "Workflow":["Workflow restructuring","Process adaptation","Routine disruption","Workflow friction","Integration overhead"],
    "Control vs. Delegation":["Delegation hesitance","Override instinct","Control retention","Autonomy tension","Supervision reflex","Delegation boundary"],
    "Abandonment":["Silent disengagement","Quiet withdrawal","Progressive drop-off","Usage fade","Abandonment trigger"],
    "Onboarding":["First-impression weight","Early experience bias","Initial calibration","Onboarding friction","Entry barrier"],
    "Stickiness":["Retention driver","Engagement anchor","Habit formation","Continued-use factor","Re-engagement pattern"],
    "Identity Under Pressure":["Professional identity threat","Role uncertainty","Craft devaluation","Expertise anxiety","Identity disruption","Status erosion"],
    "Accountability Vacuum":["Ownership ambiguity","Blame diffusion","Attribution gap","Responsibility void","Governance gap","Accountability absence"],
    "Skill Atrophy Effect":["Skill degradation","Capability erosion","Competence decline","Deskilling risk","Practice gap","Expertise fade"],
    "Labor Redistribution Effect":["Work redistribution","Role displacement","Task reallocation","Effort restructuring","Labor shift"],
    "Equity Inversion":["Access disparity","Equity gap","Unequal benefit","Advantage asymmetry"],
    "Latent Need":["Unmet need","Hidden requirement","Emergent need","Unspoken demand"],
  };
  const skip = new Set(["Assistive AI","Agentic AI"]);

  const usedLabels = new Set();
  const labelFor = (ins, idx) => {
    const tags = (ins.tags || []).filter(t => !skip.has(t));
    for (const tag of tags) { const pool = codebook[tag]; if (!pool) continue; const pick = pool[(idx + _s) % pool.length]; if (!usedLabels.has(pick)) { usedLabels.add(pick); return pick; } }
    for (const tag of tags) { const pool = codebook[tag]; if (!pool) continue; for (const label of pool) { if (!usedLabels.has(label)) { usedLabels.add(label); return label; } } }
    return tags[0] || "Observed pattern";
  };

  const PERC = new Set(["Trust","Trust Gap","Mental Model","Mental Model Problem","Transparency Imperative"]);
  const BEHV = new Set(["Workflow","Control vs. Delegation","Abandonment","Onboarding","Stickiness"]);
  const STKS = new Set(["Identity Under Pressure","Accountability Vacuum","Skill Atrophy Effect","Labor Redistribution Effect","Equity Inversion","Latent Need"]);

  const buckets = { perception:[], behavior:[], stakes:[] };
  insights.forEach((ins, idx) => {
    const tags = (ins.tags || []).filter(t => !skip.has(t));
    const pS = tags.filter(t => PERC.has(t)).length;
    const bS = tags.filter(t => BEHV.has(t)).length;
    const sS = tags.filter(t => STKS.has(t)).length;
    const entry = { ins, idx, label: "", value: 0 };
    if (pS >= bS && pS >= sS) buckets.perception.push(entry);
    else if (bS >= sS) buckets.behavior.push(entry);
    else buckets.stakes.push(entry);
  });

  const keys = ["perception","behavior","stakes"];
  keys.forEach(k => { if (buckets[k].length === 1) { const big = keys.reduce((a, b) => buckets[a].length >= buckets[b].length && a !== k ? a : b); buckets[big].push(...buckets[k].splice(0)); } });
  for (let pass = 0; pass < 2; pass++) { const cs = keys.map(k => buckets[k].length); const maxK = keys[cs.indexOf(Math.max(...cs))]; const minK = keys[cs.indexOf(Math.min(...cs))]; if (buckets[maxK].length >= 5 && buckets[minK].length === 0) buckets[minK].push(...buckets[maxK].splice(-2)); }
  keys.forEach(k => { buckets[k].forEach((entry, i) => { entry.label = labelFor(entry.ins, entry.idx + i); entry.value = r(26, 84); }); buckets[k].sort((a, b) => b.value - a.value); });

  const user = study.user;
  const questionFor = (bucket, entries) => {
    const bt = entries.flatMap(e => (e.ins.tags || []).filter(t => !skip.has(t)));
    const has = (t) => bt.includes(t);
    if (bucket === 'perception') {
      if (has('Trust Gap')) return `What eroded ${user}s' trust?`;
      if (has('Mental Model Problem')) return `What misconceptions shaped how ${user}s understood the AI?`;
      if (has('Transparency Imperative')) return `What did ${user}s need to see but couldn't?`;
      return `How did ${user}s perceive the technology?`;
    }
    if (bucket === 'behavior') {
      if (has('Abandonment')) return `What patterns preceded ${user}s disengaging?`;
      if (has('Control vs. Delegation')) return `How did ${user}s navigate delegation decisions?`;
      return `What behavioral patterns emerged among ${user}s?`;
    }
    if (bucket === 'stakes') {
      if (has('Identity Under Pressure')) return `What felt professionally threatening to ${user}s?`;
      if (has('Skill Atrophy Effect')) return `What capabilities were ${user}s at risk of losing?`;
      return `What was at stake for ${user}s?`;
    }
  };

  const colorFor = { perception:'#7F77DD', behavior:'#38bdf8', stakes:'#fbbf24' };
  const charts = keys.filter(k => buckets[k].length >= 2).map(k => ({ question: questionFor(k, buckets[k]), color: colorFor[k], entries: buckets[k] }));

  const [hover, setHover] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  const renderThemeTip = () => {
    if (!hover) return null;
    const [ci, bi] = hover.split("-").map(Number);
    const ch = charts[ci]; if (!ch) return null;
    const entry = ch.entries[bi]; if (!entry) return null;
    const tipW = 340;
    const left = Math.min(tipPos.x + 16, window.innerWidth - tipW - 20);
    return (
      <div style={{ position:"fixed", top: tipPos.y + 16, left, width: tipW, background:"#1E2025", border:`1px solid ${ch.color}44`, borderRadius:10, padding:"14px 16px", zIndex:1000, boxShadow:"0 14px 44px rgba(0,0,0,0.65)", pointerEvents:"none", animation:"fadeUp 0.1s ease" }}>
        <div style={{ fontSize:13.5, color:"#f0f4ff", fontFamily:"'DM Sans',sans-serif", fontWeight:600, lineHeight:1.4, marginBottom: entry.ins.bullets?.[0] ? 8 : 0 }}>{entry.ins.title}</div>
        {entry.ins.bullets?.[0] && <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", fontFamily:"'DM Sans',sans-serif", lineHeight:1.5 }}>{entry.ins.bullets[0]}</div>}
      </div>
    );
  };

  return (
    <div style={{ animation:"fadeUp 0.3s ease" }} onMouseLeave={() => setHover(null)}>
      <div style={{ background:"#252830", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"14px 20px", marginBottom:16, display:"flex", gap:20, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.9)", fontFamily:"'DM Sans',sans-serif" }}>
          <span style={{ fontWeight:600, color:"#f0f4ff" }}>{study.participants}</span>
          <span style={{ color:"rgba(255,255,255,0.65)", margin:"0 8px" }}>-</span>
          <span style={{ color:"rgba(255,255,255,0.85)" }}>{study.method}</span>
        </div>
        <div style={{ fontSize:10.5, color:"rgba(255,255,255,0.6)", fontFamily:"'DM Mono',monospace" }}>Themes coded across all sessions</div>
      </div>
      {charts.map((ch, ci) => {
        const mx = Math.max(...ch.entries.map(e => e.value));
        return (
          <div key={ci} style={{ background:"#252830", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"20px 22px", marginBottom:16 }}>
            <div style={{ fontSize:14.5, color:"rgba(255,255,255,0.8)", fontFamily:"'Fraunces',serif", fontWeight:500, fontStyle:"italic", lineHeight:1.4, marginBottom:4 }}>{ch.question}</div>
            <div style={{ fontSize:10.5, color:"rgba(255,255,255,0.55)", fontFamily:"'DM Mono',monospace", marginBottom:18 }}>% of participants who described this pattern</div>
            {ch.entries.map((entry, bi) => {
              const pct = mx > 0 ? (entry.value / mx) * 100 : 0;
              const hKey = `${ci}-${bi}`;
              const on = hover === hKey;
              return (
                <div key={bi} style={{ marginBottom:14, cursor:"default" }}
                  onMouseEnter={e => { setHover(hKey); setTipPos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}>
                  <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:5 }}>
                    <div style={{ fontSize:13, color: on ? "#f0f4ff" : "rgba(255,255,255,0.9)", fontFamily:"'DM Sans',sans-serif", fontWeight: on ? 600 : 400 }}>{entry.label}</div>
                    <div style={{ fontSize:11.5, color:"rgba(255,255,255,0.85)", fontFamily:"'DM Mono',monospace", flexShrink:0, marginLeft:12 }}>{entry.value}%</div>
                  </div>
                  <div style={{ height:20, background:"rgba(255,255,255,0.04)", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background: on ? ch.color : ch.color+"cc", borderRadius:4, transition:"all 0.3s ease" }}/>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {renderThemeTip()}
    </div>
  );
}


// ── Study Detail View ───────────────────────────────────────────────
function StudyDetailView({ study, onBack, scrollToInsight }) {
  const d = DOMAINS[study.domain] || { color:"#7F77DD", border:"rgba(127,119,221,0.35)" };
  const detail = INSIGHTS_MAP[study.id] || {};
  const insights = detail.insights || [];
  const [viewTab, setViewTab] = useState("insights");

  useEffect(() => {
    if (scrollToInsight) {
      setTimeout(() => {
        const el = document.getElementById(`insight-${scrollToInsight}`);
        if (el) el.scrollIntoView({ behavior:"smooth", block:"center" });
      }, 300);
    }
  }, [scrollToInsight]);

  return (
    <div>
      <div style={{ position:"sticky",top:0,zIndex:50,background:"#1E2025",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"12px 0",display:"flex",alignItems:"center",gap:14 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.9)",borderRadius:6,padding:"6px 14px",fontSize:12.5,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"flex",alignItems:"center",gap:6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back
        </button>
        <span style={{ fontSize:12,color:"rgba(255,255,255,0.8)",fontFamily:"'DM Sans',sans-serif",fontWeight:500 }}>{study.title}</span>
        <span style={{ fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono',monospace" }}>{study.id}</span>
      </div>

      <div style={{ maxWidth:900,margin:"0 auto",padding:"24px 0 80px",animation:"fadeUp 0.3s ease" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap" }}>
          <DomainPill code={study.domain} />
          <span style={{ fontSize:11,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace" }}>{study.method}</span>
          <span style={{ fontSize:11,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Mono',monospace" }}>- {study.participants}</span>
        </div>
        <h1 style={{ fontSize:42,fontWeight:900,lineHeight:1.22,fontFamily:"'Fraunces',serif",letterSpacing:"-0.025em",margin:"0 0 12px",color:"#f0f4ff",paddingBottom:"0.1em" }}>{study.title}</h1>
        <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:36,flexWrap:"wrap" }}>
          <span style={{ fontSize:13,color:"rgba(255,255,255,0.85)" }}>{study.user}</span>
          <Tag label={study.metaTheme}/>
        </div>
        <div style={{ borderLeft:`3px solid ${d.color}`,paddingLeft:22,marginBottom:36 }}>
          <p style={{ fontSize:21,fontWeight:700,lineHeight:1.4,fontFamily:"'Fraunces',serif",margin:0,color:"#f0f4ff",letterSpacing:"-0.01em" }}>{study.headline}</p>
        </div>
        {detail.anchor&&(
          <div style={{ marginBottom:28 }}>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8 }}>Study Anchor</div>
            <p style={{ fontSize:13,color:"rgba(255,255,255,0.9)",fontFamily:"'DM Sans',sans-serif",fontStyle:"italic" }}>{detail.anchor}</p>
          </div>
        )}
        {detail.coreProblem&&(
          <div style={{ background:"#252830",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"22px 24px",marginBottom:16 }}>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12 }}>Core Problem</div>
            <p style={{ fontSize:14.5,color:"rgba(255,255,255,0.92)",lineHeight:1.7,fontFamily:"'Fraunces',serif",fontWeight:400 }}>{detail.coreProblem}</p>
          </div>
        )}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:32 }}>
          {detail.soWhat&&(
            <div style={{ background:"rgba(127,119,221,0.07)",border:"1px solid rgba(127,119,221,0.22)",borderRadius:10,padding:"20px 22px",position:"relative",overflow:"hidden" }}>
              <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#7F77DD,#AFA9EC)" }}/>
              <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:10 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7F77DD" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span style={{ fontSize:10,color:"#7F77DD",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase" }}>Action</span>
              </div>
              <p style={{ fontSize:13.5,color:"rgba(255,255,255,0.95)",lineHeight:1.65,fontFamily:"'DM Sans',sans-serif" }}>{detail.soWhat}</p>
            </div>
          )}
          {detail.stakes&&(
            <div style={{ background:"rgba(251,191,36,0.06)",border:"1px solid rgba(251,191,36,0.22)",borderRadius:10,padding:"20px 22px",position:"relative",overflow:"hidden" }}>
              <div style={{ position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#f59e0b,#f87171)" }}/>
              <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:10 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span style={{ fontSize:10,color:"#f59e0b",fontFamily:"'DM Mono',monospace",letterSpacing:"0.08em",textTransform:"uppercase" }}>What's at Stake</span>
              </div>
              <p style={{ fontSize:13.5,color:"rgba(255,255,255,0.95)",lineHeight:1.65,fontFamily:"'DM Sans',sans-serif" }}>{detail.stakes}</p>
            </div>
          )}
        </div>
        <StudyLocalSearch study={study} detail={detail} domainColor={d.color}/>
        <div style={{ background:"#252830",border:`1px solid ${d.border}`,borderRadius:10,padding:"18px 22px",marginBottom:24 }}>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14 }}>
            <div>
              <div style={{ fontSize:20,fontWeight:800,color:"#f0f4ff",fontFamily:"'Fraunces',serif" }}>{study.participants?.match(/\d+/)?.[0] || "\u2014"}</div>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.04em",textTransform:"uppercase",marginTop:2 }}>Participants</div>
            </div>
            <div>
              <div style={{ fontSize:14,fontWeight:600,color:"#f0f4ff",fontFamily:"'DM Sans',sans-serif",lineHeight:1.3 }}>{study.method || "\u2014"}</div>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.04em",textTransform:"uppercase",marginTop:2 }}>Method</div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.06)", marginBottom:24 }}>
          {[{key:"insights",label:"Insights",count:insights.length},{key:"patterns",label:"Patterns"}].map(tab=>(
            <button key={tab.key} onClick={()=>setViewTab(tab.key)} style={{ background:"none",border:"none",color:viewTab===tab.key?"#f0f4ff":"rgba(255,255,255,0.35)",borderBottom:`2px solid ${viewTab===tab.key?"#7F77DD":"transparent"}`,padding:"12px 18px",fontSize:13,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:500,marginBottom:-1,transition:"all 0.15s ease",letterSpacing:"0.01em",display:"flex",alignItems:"center",gap:7 }}>
              {tab.label}
              {tab.count!=null&&<span style={{ fontSize:10,color:viewTab===tab.key?"rgba(127,119,221,0.7)":"rgba(255,255,255,0.2)",fontFamily:"'DM Mono',monospace" }}>{tab.count}</span>}
            </button>
          ))}
        </div>
        {viewTab==="insights"&&(
          <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
            {insights.map((ins,i)=>(
              ins.type === "survey"
                ? <div key={ins.id} id={`insight-${ins.id}`}><SurveyInsightCard insight={ins} domainColor={d.color} index={i}/></div>
                : <div key={ins.id} id={`insight-${ins.id}`}><InsightCard insight={ins} domainColor={d.color} index={i}/></div>
            ))}
          </div>
        )}
        {viewTab==="patterns"&&(
          <PatternsView study={study} detail={detail} domainColor={d.color}/>
        )}
      </div>
    </div>
  );
}

// ── Latent Needs Dashboard ──────────────────────────────────────────
function LatentNeedsDashboard({ onStudyClick }) {
  const [tooltip, setTooltip] = useState({ visible:false, x:0, y:0, need:null });

  const filteredProfiles = ALL_PROFILES;

  const domainForProfile = (p) => {
    const key = Object.keys(DOMAINS).find(k=>DOMAINS[k].label===p.primaryDomain)||"ENT";
    return DOMAINS[key] || { color:"#7F77DD" };
  };

  const maxFreq = Math.max(...ALL_PROFILES.flatMap(p=>(p.topNeeds||[]).map(n=>n.frequency)), 1);

  const showTooltip = (e, need) => { setTooltip({ visible:true, x:e.clientX, y:e.clientY, need }); };
  const moveTooltip = (e) => { if (tooltip.visible) setTooltip(t=>({...t, x:e.clientX, y:e.clientY})); };

  return (
    <div style={{ animation:"fadeUp 0.3s ease" }}>
      <div style={{ marginBottom:36 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:10 }}>
          <div style={{ width:6,height:6,borderRadius:"50%",background:"#7F77DD" }}/>
          <span style={{ fontSize:10,color:"#7F77DD",fontFamily:"'DM Mono',monospace",letterSpacing:"0.1em",textTransform:"uppercase" }}>User Needs</span>
        </div>
        <h2 style={{ fontSize:38,fontWeight:900,color:"#f0f4ff",letterSpacing:"-0.025em",marginBottom:8,fontFamily:"'Fraunces',serif" }}>What do users actually need?</h2>
        <p style={{ fontSize:14,color:"rgba(255,255,255,0.85)",lineHeight:1.6,maxWidth:560 }}>The top needs across every user type studied, ranked by frequency.</p>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16 }}>
        {filteredProfiles.map((profile, pi)=>{
          const d = domainForProfile(profile);
          return (
            <div key={profile.id} style={{ background:"#252830",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,overflow:"hidden",animation:`fadeUp 0.3s ease ${pi*0.03}s both` }}>
              <div style={{ height:3,background:`linear-gradient(90deg,${d.color},transparent)` }}/>
              <div style={{ padding:"18px 20px" }}>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12 }}>
                  <div>
                    <div style={{ fontSize:14,fontWeight:700,color:"#f0f4ff",fontFamily:"'Fraunces',serif",marginBottom:4 }}>{profile.title}</div>
                    <DomainPill code={Object.keys(DOMAINS).find(k=>DOMAINS[k].label===profile.primaryDomain)||"ENT"} small/>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:11,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Mono',monospace" }}>{profile.studyRefs?.length || 0} studies</div>
                  </div>
                </div>
                {profile.quote&&(
                  <div style={{ background:"rgba(255,255,255,0.04)",borderRadius:6,padding:"8px 10px",marginBottom:14,borderLeft:`2px solid ${d.color}` }}>
                    <p style={{ fontSize:12,color:"#f0f4ff",fontStyle:"italic",fontFamily:"'Fraunces',serif",lineHeight:1.5,marginBottom:6 }}>"{profile.quote.text}"</p>
                    <p style={{ fontSize:10,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace" }}>{profile.quote.attr}</p>
                  </div>
                )}
                {profile.topNeeds?.length>0&&(
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:9.5,color:"rgba(255,255,255,0.9)",fontWeight:700,fontFamily:"'DM Mono',monospace",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:10 }}>Top Needs</div>
                    <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                      {profile.topNeeds.slice(0,4).map((need,i)=>(
                        <div key={i} onMouseEnter={e=>showTooltip(e,need)} onMouseMove={moveTooltip} onMouseLeave={()=>setTooltip(t=>({...t,visible:false}))} style={{ cursor:"default" }}>
                          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5 }}>
                            <span style={{ fontSize:11.5,color:"rgba(255,255,255,0.9)",fontFamily:"'DM Sans',sans-serif",flex:1,paddingRight:8,lineHeight:1.3 }}>{need.need}</span>
                            <span style={{ fontSize:10,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace",flexShrink:0 }}>{need.frequency}</span>
                          </div>
                          <div style={{ height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden" }}>
                            <div style={{ height:"100%",width:`${(need.frequency/maxFreq)*100}%`,background:`linear-gradient(90deg,${d.color},${d.color}88)`,borderRadius:2,transition:"width 0.8s ease" }}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop:14,display:"flex",flexWrap:"wrap",alignItems:"center",gap:5 }}>
                  <span style={{ fontSize:10,color:"rgba(255,255,255,0.55)",fontFamily:"'DM Mono',monospace",letterSpacing:"0.04em",flexShrink:0 }}>Source studies:</span>
                  {(profile.studyRefs||[]).map((ref,ri)=>{
                    const study = STUDY_INDEX[ref];
                    return (
                      <span key={ri} onClick={study?()=>onStudyClick(study):undefined}
                        style={{ fontSize:10,fontFamily:"'DM Mono',monospace",color:study?"rgba(127,119,221,0.7)":"rgba(255,255,255,0.2)",cursor:study?"pointer":"default",background:study?"rgba(127,119,221,0.08)":"none",border:study?"1px solid rgba(127,119,221,0.2)":"none",borderRadius:3,padding:study?"1px 6px":"0",transition:"all 0.15s ease" }}
                      >{ref}</span>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {tooltip.visible&&tooltip.need&&(
        <div style={{ position:"fixed",top:Math.min(tooltip.y+16, window.innerHeight - 120),left:Math.min(tooltip.x+12, window.innerWidth - 320),background:"#252830",border:"1px solid rgba(127,119,221,0.25)",borderRadius:10,padding:"14px 16px",maxWidth:300,zIndex:1000,boxShadow:"0 12px 40px rgba(0,0,0,0.6)",pointerEvents:"none",animation:"fadeUp 0.1s ease" }}>
          <div style={{ fontSize:11,fontWeight:600,color:"#f0f4ff",fontFamily:"'DM Sans',sans-serif",marginBottom:8,lineHeight:1.35 }}>{tooltip.need.need}</div>
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:8 }}>
            <span style={{ fontSize:10,color:"rgba(255,255,255,0.65)",fontFamily:"'DM Mono',monospace" }}>{tooltip.need.insightRefs?.length||0} insights</span>
            <span style={{ fontSize:10,color:"rgba(255,255,255,0.6)",fontFamily:"'DM Mono',monospace" }}>freq {tooltip.need.frequency}</span>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Use Case Evaluator Tab (client-side) ──────────────────────────
function UseCasesTab({ onStudyClick }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hoveredIns, setHoveredIns] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

  const EXAMPLES = [
    "Using AI to draft performance reviews for managers",
    "Automating customer support ticket triage with AI",
    "Replacing manual data entry with AI-assisted form filling",
    "Letting AI suggest workflow steps for operations teams",
    "Using AI to summarize long documents for executives",
    "Building AI-powered search for internal knowledge bases",
    "Automating code review feedback with AI",
    "Using AI to personalize learning paths for employees",
  ];

  const evaluate = () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    setTimeout(() => {
      const res = clientUseCaseEvaluate(query);
      setResult(res);
      setLoading(false);
    }, 500);
  };

  const findStudyId = ref => { const m = ref.match(/\(([A-Z]+-\d+)\)/); return m ? m[1] : null; };
  const findStudy  = ref => { const id = findStudyId(ref); return id ? (STUDY_INDEX[id] || null) : null; };
  const findInsight = (ref, aiTitle) => {
    const id = findStudyId(ref);
    if (!id || !INSIGHTS_MAP[id]) return null;
    const ins = INSIGHTS_MAP[id].insights || [];
    if (!ins.length) return null;
    const words = new Set(aiTitle.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    let best = ins[0], bestScore = 0;
    for (const i of ins) {
      const s = i.title.toLowerCase().split(/\W+/).filter(w => words.has(w)).length;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return { ...best, studyId: id, studyDomain: STUDY_INDEX[id]?.domain };
  };

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7F77DD" }} />
          <span style={{ fontSize: 10, color: "#7F77DD", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>Use Case Evaluator</span>
        </div>
        <h2 style={{ fontSize: 38, fontWeight: 900, color: "#f0f4ff", letterSpacing: "-0.025em", marginBottom: 8, fontFamily: "'Fraunces',serif" }}>How does this use case hold up?</h2>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, maxWidth: 600 }}>Describe a use case. Presto checks it against the research library.</p>
      </div>
      <div style={{ position: "relative", marginBottom: 20 }}>
        <textarea value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); evaluate(); } }}
          placeholder="e.g. Using AI to automate customer support responses..."
          rows={3}
          style={{ width: "100%", background: "#1E2025", border: "1.5px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "18px 56px 18px 20px", fontSize: 15, color: "#f0f4ff", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.6, resize: "none", outline: "none", transition: "border-color 0.2s ease", caretColor: "#7F77DD", boxSizing: "border-box" }}
          onFocus={e => e.target.style.borderColor = "rgba(127,119,221,0.5)"}
          onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
        />
        <button onClick={evaluate} disabled={loading || !query.trim()}
          style={{ position: "absolute", bottom: 14, right: 14, background: loading || !query.trim() ? "rgba(127,119,221,0.2)" : "#7F77DD", color: loading || !query.trim() ? "rgba(255,255,255,0.3)" : "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 12.5, fontWeight: 700, cursor: loading || !query.trim() ? "default" : "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s ease" }}
        >{loading ? "Evaluating..." : "Evaluate"}</button>
      </div>
      {!result && !loading && (
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>Try one of these</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {EXAMPLES.map((ex, i) => (
              <button key={i} onClick={() => setQuery(ex)}
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)", borderRadius: 20, padding: "5px 14px", fontSize: 12, fontFamily: "'DM Sans',sans-serif", cursor: "pointer", transition: "all 0.15s ease" }}
              >{ex}</button>
            ))}
          </div>
        </div>
      )}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "40px 0" }}>
          <div style={{ display: "flex", gap: 5 }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#7F77DD", animation: `pulse 1.2s ${i * 0.2}s infinite` }} />)}</div>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontFamily: "'DM Sans',sans-serif" }}>Checking against {STUDIES_DATA.length} studies...</span>
        </div>
      )}
      {result && !result.error && (
        <div style={{ animation: "fadeUp 0.3s ease" }}>
          <div style={{ background: "#252830", border: "1px solid rgba(127,119,221,0.2)", borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
            <div style={{ height: 4, background: "linear-gradient(90deg, #7F77DD, #7F77DD44)" }} />
            <div style={{ padding: "26px 28px" }}>
              <p style={{ fontSize: 20, fontWeight: 800, color: "#f0f4ff", lineHeight: 1.3, letterSpacing: "-0.02em", marginBottom: 16, fontFamily: "'DM Sans',sans-serif" }}>{result.headline}</p>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.88)", lineHeight: 1.7, fontFamily: "'DM Sans',sans-serif", margin: 0 }}>{result.human_context}</p>
              {result.confidence && <div style={{ marginTop: 16 }}><ConfidenceBadge level={result.confidence} rationale={result.confidence_rationale}/></div>}
            </div>
            {result.bottom_line && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "14px 28px", background: "rgba(127,119,221,0.04)", display: "flex", alignItems: "center", gap: 10 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7F77DD" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span style={{ fontSize: 10, color: "#7F77DD", fontFamily: "'DM Mono',monospace", letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>Key takeaway</span>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.9)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.4 }}>{result.bottom_line}</span>
              </div>
            )}
          </div>
          {result.scope_check && (
            <div style={{ marginBottom: 16, background: "rgba(127,119,221,0.05)", border: "1px solid rgba(127,119,221,0.2)", borderRadius: 11, padding: "18px 22px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7F77DD" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <div>
                  <div style={{ fontSize: 9.5, color: "#7F77DD", fontFamily: "'DM Mono',monospace", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>Scope check</div>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, fontFamily: "'DM Sans',sans-serif", margin: 0 }}>{result.scope_check}</p>
                </div>
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {result.what_to_watch_for?.length > 0 && (
              <div style={{ background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.15)", borderRadius: 11, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#fbbf24,transparent)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <span style={{ fontSize: 9.5, color: "#fbbf24", fontFamily: "'DM Mono',monospace", letterSpacing: "0.07em", textTransform: "uppercase" }}>What to watch for</span>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.what_to_watch_for.map((f, i) => (
                    <li key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <span style={{ color: "#fbbf24", fontSize: 13, lineHeight: 1.5, flexShrink: 0, marginTop: 1 }}>{"\u2014"}</span>
                      <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.92)", lineHeight: 1.55, fontFamily: "'DM Sans',sans-serif" }}>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.what_makes_it_work?.length > 0 && (
              <div style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.18)", borderRadius: 11, padding: "18px 20px", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#34d399,transparent)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                  <span style={{ fontSize: 9.5, color: "#34d399", fontFamily: "'DM Mono',monospace", letterSpacing: "0.07em", textTransform: "uppercase" }}>What makes it work</span>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.what_makes_it_work.map((c, i) => (
                    <li key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <span style={{ color: "#34d399", fontSize: 13, lineHeight: 1.5, flexShrink: 0, marginTop: 1 }}>{"\u2014"}</span>
                      <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.92)", lineHeight: 1.55, fontFamily: "'DM Sans',sans-serif" }}>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {result.related_needs?.length > 0 && (
            <div style={{ background: "#252830", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 11, padding: "18px 22px", marginBottom: 16 }}>
              <div style={{ fontSize: 9.5, color: "#7F77DD", fontFamily: "'DM Mono',monospace", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 16 }}>Connected User Needs</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {result.related_needs.map((n, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", background: n.type === "frustration" ? "rgba(248,113,113,0.04)" : "rgba(52,211,153,0.04)", border: `1px solid ${n.type === "frustration" ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.12)"}`, borderRadius: 8 }}>
                    <span style={{ fontSize: 9, color: n.type === "frustration" ? "#f87171" : "#34d399", fontFamily: "'DM Mono',monospace", letterSpacing: "0.05em", textTransform: "uppercase", flexShrink: 0, paddingTop: 2, minWidth: 70 }}>{n.type === "frustration" ? "Frustration" : "Need"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.88)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.45, fontWeight: 500 }}>{n.need_text}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.4, marginTop: 3 }}>{n.relevance}</div>
                    </div>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>{n.user}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.insights?.length > 0 && (
            <div style={{ background: "#252830", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 11, overflow: "hidden" }}>
              <div style={{ padding: "16px 22px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.65)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.07em", textTransform: "uppercase", paddingBottom: 14 }}>Research that informed this</div>
              </div>
              <div style={{ padding: "4px 22px 12px" }}>
                {result.insights.map((ins, i) => {
                  const study = findStudy(ins.study);
                  const d = study ? DOMAINS[study.domain] : null;
                  return (
                    <div key={i}
                      onClick={study ? () => onStudyClick(study) : undefined}
                      onMouseEnter={e => { const r=findInsight(ins.study,ins.title); setHoveredIns(r); setHoverPos({ x: e.clientX, y: e.clientY }); }}
                      onMouseMove={e => setHoverPos({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHoveredIns(null)}
                      style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: study ? "pointer" : "default" }}
                    >
                      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", fontFamily: "'DM Mono',monospace", minWidth: 18, flexShrink: 0 }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", fontFamily: "'DM Sans',sans-serif", fontWeight: 500, lineHeight: 1.4 }}>{(()=>{ const r=findInsight(ins.study,ins.title); return r?.title||ins.title; })()}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                        {d && <span style={{ width: 6, height: 6, borderRadius: "50%", background: d.color, flexShrink: 0 }} />}
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap" }}>{findStudyId(ins.study) || ins.study}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {hoveredIns && (() => {
                const d = DOMAINS[hoveredIns.studyDomain];
                const dColor = d?.color || "#7F77DD";
                const cardW = 390;
                const left = hoverPos.x + 16 + cardW > window.innerWidth ? hoverPos.x - cardW - 16 : hoverPos.x + 16;
                const top = Math.min(hoverPos.y - 20, window.innerHeight - 440);
                return (
                  <div style={{ position: "fixed", top, left, width: cardW, background: "#252830", border: `1px solid ${dColor}44`, borderRadius: 12, overflow: "hidden", zIndex: 9999, boxShadow: "0 24px 70px rgba(0,0,0,0.75)", pointerEvents: "none", animation: "fadeUp 0.12s ease" }}>
                    <div style={{ height: 3, background: `linear-gradient(90deg,${dColor},transparent)` }} />
                    <div style={{ padding: "16px 20px" }}>
                      <div style={{ fontSize: 9.5, color: dColor, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{hoveredIns.studyId}</div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: "#f0f4ff", fontFamily: "'Fraunces',serif", lineHeight: 1.35, letterSpacing: "-0.01em", marginBottom: 13 }}>{hoveredIns.title}</p>
                      <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
                        {hoveredIns.bullets?.slice(0, 3).map((b, j) => (
                          <li key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{ color: dColor, fontSize: 12, lineHeight: 1.4, flexShrink: 0 }}>{"\u2014"}</span>
                            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.52, fontFamily: "'DM Sans',sans-serif" }}>{b}</span>
                          </li>
                        ))}
                      </ul>
                      {hoveredIns.action && (
                        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 7, padding: "10px 13px" }}>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Action</div>
                          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", lineHeight: 1.52, fontFamily: "'DM Sans',sans-serif", margin: 0 }}>{hoveredIns.action}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <div style={{ marginTop: 24, textAlign: "center" }}>
            <button onClick={() => { setResult(null); setQuery(""); }}
              style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", borderRadius: 8, padding: "8px 22px", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s ease" }}
            >Evaluate another use case</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Workflow Diagrams (from original presto_preview.jsx) ────────────
const WORKFLOW_DIAGRAMS = [
  {
    id: "WF-FLW-01", user: "Operations Manager", domain: "OPS",
    task: "Building their first automation in Flow",
    context: "A new operations lead opens Flow for the first time. They need to automate their team's PTO approval process. The blank canvas is waiting.",
    products: ["Flow"],
    steps: [
      { label: "Opens the workflow builder", detail: "Sees an empty canvas with a toolbar. No guidance on where to start. The cursor blinks." },
      { label: "Stares at the blank canvas for 90 seconds", highlight: true, detail: "They know what they want to build \u2014 automate PTO approvals. They don't know where to click first." },
      { label: "Searches for a template", detail: "Finds a PTO template. Deploys it in 11 minutes. Has no idea what the 8 steps inside it actually do." },
      { label: "Template works. Decides to build a second workflow from scratch.", detail: "This time there's no template. They're back to the blank canvas. The 90-second stare returns." },
    ],
    decision: "Can they build without a template?",
    leftBranch: { label: "no", title: "Gives up on custom builds", subtitle: "Stays template-dependent", color: "amber", friction: "Template ceiling" },
    rightBranch: { label: "yes", title: "Builds from scratch", subtitle: "Takes 40 min instead of 11", color: "green" },
    convergence: "Workflow goes live",
    annotations: [
      { title: "The blank canvas is the #1 dropout trigger", text: "Users who don't make their first move within 60 seconds are 3x more likely to abandon the session. The problem isn't capability \u2014 it's orientation." },
      { title: "Template users complete 3x faster but can't modify what they built", text: "Templates solve the speed problem and create a comprehension problem. When the template needs to flex, the user is stuck." }
    ]
  },
  {
    id: "WF-PLS-01", user: "People Manager", domain: "ENT",
    task: "Receiving and acting on engagement survey results",
    context: "An engineering manager gets notified that their team's latest Pulse results are ready. Their engagement score is 68. They have 30 minutes before their next meeting.",
    products: ["Pulse"],
    steps: [
      { label: "Opens the Pulse dashboard", detail: "Sees the number: 68. It was 71 last quarter. They feel a knot in their stomach." },
      { label: "Tries to understand what drove the drop", highlight: true, detail: "The dashboard shows the score. It doesn't show the drivers. They click around looking for 'why.'" },
      { label: "Gives up on the dashboard, opens the action plan tool", detail: "Types 'improve communication' in the action plan field. It's the same plan they wrote last quarter." },
      { label: "Closes the tab and goes to their meeting", detail: "The action plan sits there. They'll look at it again next quarter. Probably." },
    ],
    decision: "Do they know what lever to pull?",
    leftBranch: { label: "no", title: "Creates a vague action plan", subtitle: "'Improve communication'", color: "amber", friction: "No actionable signal" },
    rightBranch: { label: "yes", title: "Schedules a team conversation", subtitle: "Co-creates a specific plan", color: "green" },
    convergence: "Next quarter's survey arrives",
    annotations: [
      { title: "15 of 15 managers could state their score. 3 of 15 could name the top driver.", text: "The dashboard shows outcomes but not inputs. Managers can see the number but can't see what produced it \u2014 so they act on assumptions." },
      { title: "Managers who involved their team in the action plan were 6x more likely to follow through", text: "Solo plans complete at 11%. Co-created plans complete at 67%. The conversation is the intervention." }
    ]
  },
  {
    id: "WF-CON-01", user: "Enterprise Employee", domain: "ENT",
    task: "Searching for a decision made three weeks ago in Connect",
    context: "A product manager needs the pricing decision from three weeks ago. They know it was discussed somewhere. They open Connect search.",
    products: ["Connect"],
    steps: [
      { label: "Types a search query", detail: "'pricing decision Q2' \u2014 returns 47 messages across 6 channels. None of them are the decision." },
      { label: "Refines the search", detail: "Tries 'pricing approved', 'final price', 'pricing update'. Each returns a different set of messages. None contain the conclusion." },
      { label: "Opens the most likely channel and scrolls", highlight: true, detail: "Finds the thread where pricing was discussed. It's 84 messages long. The decision is in reply #71." },
      { label: "Gives up and messages a colleague", detail: "'Hey Rachel, do you remember what we decided on pricing?' Rachel doesn't remember either. She asks someone else." },
    ],
    decision: "Can they find the decision?",
    leftBranch: { label: "no", title: "Asks a colleague", subtitle: "Who also can't find it", color: "amber", friction: "Search failure cascade" },
    rightBranch: { label: "eventually", title: "Finds it in a thread reply", subtitle: "Took 25 minutes", color: "gray" },
    convergence: "Decision is (re)confirmed",
    annotations: [
      { title: "Users search 6 times per day and succeed twice", text: "The 67% failure rate isn't a search quality problem \u2014 it's a content structure problem. Search returns messages. Users want decisions." },
      { title: "One team prefixed decisions with 'DECIDED:' and had 89% search success vs. 33% for everyone else", text: "The best solution is already being used by one team. Nobody else knows about it because there's no mechanism to spread the convention." }
    ]
  },
  {
    id: "WF-LNS-01", user: "Data Analyst", domain: "DAT",
    task: "Sharing a dashboard with an executive who wasn't involved in building it",
    context: "A senior analyst built a revenue dashboard over two weeks. They share it with the VP of Product for a quarterly review. The VP opens it for the first time.",
    products: ["Lens"],
    steps: [
      { label: "VP opens the shared dashboard", detail: "Sees 6 charts. Recognizes the revenue trend line. The other 5 charts need context they don't have." },
      { label: "VP forms an interpretation in 8 seconds", highlight: true, detail: "Their eye lands on the biggest chart. They read it as 'revenue is growing.' The analyst built it to show 'growth is decelerating.'" },
      { label: "VP presents the dashboard in a leadership meeting", detail: "Cites the revenue chart as evidence that things are going well. The analyst isn't in the room." },
      { label: "Analyst discovers the misinterpretation two weeks later", detail: "A product decision was made based on the wrong reading. The data was right. The interpretation was wrong. Nobody knew." },
    ],
    decision: "Does the VP interpret it correctly?",
    leftBranch: { label: "no", title: "Misreads the chart", subtitle: "Acts on wrong interpretation", color: "red", friction: "Interpretation gap" },
    rightBranch: { label: "yes", title: "Asks the analyst to explain", subtitle: "Gets the right context", color: "green" },
    convergence: "Decision is made from the dashboard",
    annotations: [
      { title: "Builder and reader draw different conclusions 40% of the time", text: "The builder knows context the chart doesn't show. The reader fills gaps with assumptions. A one-sentence annotation reduces divergence from 40% to 12%." },
      { title: "Readers form their interpretation in 8 seconds and rarely change it", text: "The first 8 seconds determine the takeaway for the entire meeting. Everything after that is commentary on a conclusion already formed." }
    ]
  },
  {
    id: "WF-FLW-02", user: "Operations Manager", domain: "OPS",
    task: "Diagnosing why an automation failed overnight",
    context: "An ops manager arrives at 8am. Three Slack messages say the automated invoicing workflow didn't run. They open Flow to figure out what happened.",
    products: ["Flow"],
    steps: [
      { label: "Opens the workflow and sees 'Failed' status", detail: "The error says: 'Workflow execution failed.' No step identified. No cause. No suggestion." },
      { label: "Assumes they built something wrong", highlight: true, detail: "Starts reviewing each step, looking for what they misconfigured. This takes 30 minutes." },
      { label: "Deletes and rebuilds two steps that seem suspicious", detail: "It's superstitious debugging \u2014 they don't know what broke, so they rebuild what feels wrong." },
      { label: "Workflow runs successfully on retry", detail: "It was a transient server issue. The 30 minutes of debugging were unnecessary. They don't know that." },
    ],
    decision: "Do they know what caused the failure?",
    leftBranch: { label: "no", title: "Blames themselves", subtitle: "Rebuilds steps that weren't broken", color: "amber", friction: "Self-blame loop" },
    rightBranch: { label: "yes", title: "Recognizes a platform issue", subtitle: "Retries without changes", color: "green" },
    convergence: "Workflow is running again",
    annotations: [
      { title: "9 of 12 users assumed they caused the error \u2014 even when the platform was at fault", text: "Error messages that don't attribute the cause default to self-blame. Users stop building after two unexplained failures." },
      { title: "One clear explanation recovered trust faster than three successful runs", text: "Explanation is a more powerful trust signal than positive outcomes. Users who were told 'this was a platform issue' recovered immediately." }
    ]
  },
];

const WF_USER_ORDER = [...new Set(WORKFLOW_DIAGRAMS.map(w => w.user))];

const WF_C = {
  gray:   { fill:"rgba(255,255,255,0.04)", stroke:"rgba(255,255,255,0.12)", accent:"rgba(255,255,255,0.45)" },
  purple: { fill:"rgba(127,119,221,0.12)", stroke:"rgba(127,119,221,0.35)", accent:"#7F77DD" },
  teal:   { fill:"rgba(52,211,153,0.12)",  stroke:"rgba(52,211,153,0.35)",  accent:"#34d399" },
  amber:  { fill:"rgba(251,146,60,0.12)",  stroke:"rgba(251,146,60,0.35)",  accent:"#fbbf24" },
  coral:  { fill:"rgba(248,113,113,0.12)", stroke:"rgba(248,113,113,0.35)", accent:"#f87171" },
  red:    { fill:"rgba(248,113,113,0.12)", stroke:"rgba(248,113,113,0.35)", accent:"#f87171" },
  green:  { fill:"rgba(52,211,153,0.12)",  stroke:"rgba(52,211,153,0.35)",  accent:"#34d399" },
};

function WorkflowDiagram({ wf, collapsed, onToggle, showUser }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  const n = wf.steps.length;
  const tw = (str, fs) => str.length * fs * 0.56 + 40;
  const fitFont = (str, boxW, base) => {
    const needed = str.length * base * 0.56 + 28;
    return needed <= boxW ? base : Math.max(9.5, base * (boxW - 28) / (str.length * base * 0.56));
  };
  const stepWidths = wf.steps.map(s => Math.max(180, Math.min(tw(s.label, 12.5), 400)));
  const PILL_W = Math.max(260, Math.min(tw(wf.decision, 12), 420));
  const BOX_H = 41;
  const PILL_H = 41;
  const leftBW = Math.max(140, Math.min(tw(wf.leftBranch.title, 12), 220));
  const rightBW = Math.max(140, Math.min(tw(wf.rightBranch.title, 12), 220));
  const OUTCOME_H = 52;
  const CONV_W = Math.max(160, Math.min(tw(wf.convergence, 12), 300));
  let CX = 340;
  const margin = 14;
  const rawLeftCX = CX - PILL_W / 2 - leftBW / 2 - margin;
  const rawRightCX = CX + PILL_W / 2 + rightBW / 2 + margin;
  const leftEdge = rawLeftCX - leftBW / 2;
  const shift = leftEdge < 10 ? (10 - leftEdge) : 0;
  const LEFT_CX = rawLeftCX + shift;
  const RIGHT_CX = rawRightCX + shift;
  CX = (LEFT_CX + RIGHT_CX) / 2;
  const CONV_CX = CX;
  const SVG_W = Math.max(680, RIGHT_CX + rightBW / 2 + 10);
  const arrId = `arr-${wf.id}`;
  const GAP = 17;
  const stepY = i => 12 + i * (BOX_H + GAP);
  const lastBottom = stepY(n - 1) + BOX_H;
  const decY = lastBottom + GAP;
  const decMid = decY + PILL_H / 2;
  const branchY = decY + PILL_H + 37;
  const convergeY = branchY + OUTCOME_H + 30;
  const svgH = convergeY + BOX_H + 15;
  const d = DOMAINS[wf.domain];
  const arrowStroke = "rgba(255,255,255,0.15)";
  const arrUrl = `url(#${arrId})`;
  const [tipData, setTipData] = useState(null);
  const showTip = (e, text) => { if (!text) return; setTipData({ text, cx: e.clientX, cy: e.clientY }); };
  const hideTip = () => setTipData(null);

  const renderBranch = (branch, cx, side, bw) => {
    const c = WF_C[branch.color] || WF_C.gray;
    const edgeX = side === "left" ? (CX - PILL_W / 2) : (CX + PILL_W / 2);
    const labelX = side === "left" ? (cx + 22) : (edgeX + 16);
    const hKey = `branch-${side}`;
    const isHov = hoveredNode === hKey;
    const tipText = branch.friction
      ? `This path leads to "${branch.title.toLowerCase()}" \u2014 ${branch.friction.toLowerCase()} shapes what happens next.`
      : `When the answer is "${branch.label}," the user ${branch.title.toLowerCase()}. ${branch.subtitle}.`;
    return (
      <>
        <path d={`M${edgeX} ${decMid} L${cx} ${decMid} L${cx} ${branchY}`} fill="none" stroke={arrowStroke} strokeWidth={1} markerEnd={arrUrl}/>
        <text x={labelX} y={decMid - 7} fill="rgba(255,255,255,0.35)" fontSize={11} fontFamily="'DM Sans',sans-serif">{branch.label}</text>
        {branch.friction && (
          <>
            <circle cx={side === "left" ? (cx - bw/2 + 7) : (cx + bw/2 - 7)} cy={branchY - 14} r={6} fill="#fbbf24" opacity={0.9}/>
            <text x={side === "left" ? (cx - bw/2 + 7) : (cx + bw/2 - 7)} y={branchY - 14} textAnchor="middle" dominantBaseline="central" fill="#1E2025" fontSize={8} fontWeight={700} fontFamily="'DM Sans',sans-serif">!</text>
            <text x={side === "left" ? (cx - bw/2 + 16) : (cx + bw/2 - 16)} y={branchY - 14} dominantBaseline="central" fill="#fbbf24" fontSize={10} fontFamily="'DM Sans',sans-serif" textAnchor={side === "left" ? "start" : "end"}>{branch.friction}</text>
          </>
        )}
        <rect x={cx - bw/2} y={branchY} width={bw} height={OUTCOME_H} rx={7}
          fill={isHov ? c.stroke : c.fill} stroke={c.stroke} strokeWidth={isHov ? 1 : 0.5}
          style={{ cursor: "default", transition: "all 0.15s ease" }}
          onMouseEnter={e => { setHoveredNode(hKey); showTip(e, tipText); }}
          onMouseMove={e => showTip(e, tipText)}
          onMouseLeave={() => { setHoveredNode(null); hideTip(); }}/>
        <text x={cx} y={branchY + 17} textAnchor="middle" dominantBaseline="central" fill="#f0f4ff" fontSize={12.5} fontWeight={600} fontFamily="'DM Sans',sans-serif" style={{ pointerEvents: "none" }}>{branch.title}</text>
        <text x={cx} y={branchY + 34} textAnchor="middle" dominantBaseline="central" fill="rgba(255,255,255,0.4)" fontSize={10.5} fontFamily="'DM Sans',sans-serif" style={{ pointerEvents: "none" }}>{branch.subtitle}</text>
        <path d={`M${cx} ${branchY + OUTCOME_H} L${cx} ${convergeY + BOX_H / 2} L${side === "left" ? (CONV_CX - CONV_W / 2) : (CONV_CX + CONV_W / 2)} ${convergeY + BOX_H / 2}`} fill="none" stroke={arrowStroke} strokeWidth={1} markerEnd={arrUrl}/>
      </>
    );
  };

  return (
    <div style={{ background: "#252830", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden", animation: "fadeUp 0.3s ease" }}>
      <div style={{ height: 3, background: `linear-gradient(90deg,${d?.color || "#7F77DD"},transparent)` }}/>
      <div onClick={onToggle}
        style={{ padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", gap: 12 }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "#f0f4ff", fontFamily: "'Fraunces',serif", lineHeight: 1.3, letterSpacing: "-0.01em" }}>{wf.task}</div>
          {wf.context && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.5, marginTop: 5 }}>{wf.context}</div>}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
            {showUser && <span style={{ fontSize: 9.5, color: d?.color || "#7F77DD", fontFamily: "'DM Mono',monospace", background: `${d?.color || "#7F77DD"}15`, border: `1px solid ${d?.color || "#7F77DD"}30`, borderRadius: 3, padding: "2px 6px" }}>{wf.user}</span>}
            {wf.products.map((p, i) => (
              <span key={i} style={{ fontSize: 9.5, color: "rgba(255,255,255,0.65)", fontFamily: "'DM Mono',monospace", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3, padding: "2px 6px" }}>{p}</span>
            ))}
          </div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, transition: "transform 0.2s ease", transform: collapsed ? "rotate(0deg)" : "rotate(180deg)" }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      {!collapsed && (
        <>
          <div style={{ maxWidth: 648, margin: "0 auto", padding: "0 12px", position: "relative" }}>
            <svg viewBox={`0 0 ${SVG_W} ${svgH}`} style={{ width: "100%", display: "block" }} xmlns="http://www.w3.org/2000/svg">
              <defs>
                <marker id={arrId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M2 1L8 5L2 9" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </marker>
              </defs>
              {wf.steps.map((step, i) => {
                const y = stepY(i);
                const c = step.highlight ? WF_C.purple : WF_C.gray;
                const hKey = `step-${i}`;
                const isHov = hoveredNode === hKey;
                const tipText = step.detail || `Step ${i + 1}: ${step.label}`;
                return (
                  <g key={i}>
                    <rect x={CX - stepWidths[i] / 2} y={y} width={stepWidths[i]} height={BOX_H} rx={7}
                      fill={isHov ? c.stroke : c.fill} stroke={c.stroke} strokeWidth={isHov ? 1 : 0.5}
                      style={{ cursor: "default", transition: "all 0.15s ease" }}
                      onMouseEnter={e => { setHoveredNode(hKey); showTip(e, tipText); }}
                      onMouseMove={e => showTip(e, tipText)}
                      onMouseLeave={() => { setHoveredNode(null); hideTip(); }}/>
                    <text x={CX} y={y + BOX_H / 2} textAnchor="middle" dominantBaseline="central" fill="#f0f4ff" fontSize={fitFont(step.label, stepWidths[i], 12.5)} fontWeight={step.highlight ? 600 : 400} fontFamily="'DM Sans',sans-serif" style={{ pointerEvents: "none" }}>{step.label}</text>
                    {i < n - 1 && (
                      <line x1={CX} y1={y + BOX_H} x2={CX} y2={y + BOX_H + GAP} stroke={arrowStroke} strokeWidth={1} markerEnd={arrUrl}/>
                    )}
                  </g>
                );
              })}
              <line x1={CX} y1={lastBottom} x2={CX} y2={decY} stroke={arrowStroke} strokeWidth={1} markerEnd={arrUrl}/>
              {(() => {
                const hKey = "decision";
                const isHov = hoveredNode === hKey;
                const tipText = `Decision point: "${wf.decision}"`;
                return (
                  <g>
                    <rect x={CX - PILL_W / 2} y={decY} width={PILL_W} height={PILL_H} rx={19}
                      fill={isHov ? WF_C.purple.stroke : WF_C.purple.fill} stroke={WF_C.purple.stroke} strokeWidth={isHov ? 1 : 0.5}
                      style={{ cursor: "default", transition: "all 0.15s ease" }}
                      onMouseEnter={e => { setHoveredNode(hKey); showTip(e, tipText); }}
                      onMouseMove={e => showTip(e, tipText)}
                      onMouseLeave={() => { setHoveredNode(null); hideTip(); }}/>
                    <text x={CX} y={decY + PILL_H / 2} textAnchor="middle" dominantBaseline="central" fill="#7F77DD" fontSize={fitFont(wf.decision, PILL_W, 12.5)} fontWeight={600} fontFamily="'DM Sans',sans-serif" style={{ pointerEvents: "none" }}>{wf.decision}</text>
                  </g>
                );
              })()}
              {renderBranch(wf.leftBranch, LEFT_CX, "left", leftBW)}
              {renderBranch(wf.rightBranch, RIGHT_CX, "right", rightBW)}
              <rect x={CONV_CX - CONV_W / 2} y={convergeY} width={CONV_W} height={BOX_H} rx={7} fill={WF_C.gray.fill} stroke={WF_C.gray.stroke} strokeWidth={0.5}/>
              <text x={CONV_CX} y={convergeY + BOX_H / 2} textAnchor="middle" dominantBaseline="central" fill="rgba(255,255,255,0.65)" fontSize={12} fontFamily="'DM Sans',sans-serif" style={{ pointerEvents: "none" }}>{wf.convergence}</text>
            </svg>
          </div>
          {wf.annotations?.length > 0 && (
            <div style={{ padding: "0 24px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {wf.annotations.map((a, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#f0f4ff", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.35, marginBottom: 6 }}>{a.title}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.55 }}>{a.text}</div>
                </div>
              ))}
            </div>
          )}
          {tipData && (
            <div style={{ position: "fixed", top: tipData.cy + 16, left: Math.min(tipData.cx + 12, window.innerWidth - 340), background: "#252830", border: "1px solid rgba(127,119,221,0.25)", borderRadius: 8, padding: "12px 14px", maxWidth: 320, zIndex: 1000, boxShadow: "0 12px 40px rgba(0,0,0,0.6)", pointerEvents: "none", animation: "fadeUp 0.1s ease" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", fontFamily: "'DM Sans',sans-serif", lineHeight: 1.5 }}>{tipData.text}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WorkflowTab() {
  const [expandedId, setExpandedId] = useState(null);
  const [userFilter, setUserFilter] = useState("all");

  const filteredWfs = userFilter === "all"
    ? WORKFLOW_DIAGRAMS
    : WORKFLOW_DIAGRAMS.filter(w => w.user === userFilter);

  return (
    <div style={{ animation: "fadeUp 0.3s ease" }}>
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7F77DD" }}/>
          <span style={{ fontSize: 10, color: "#7F77DD", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>Workflows</span>
        </div>
        <h2 style={{ fontSize: 38, fontWeight: 900, color: "#f0f4ff", letterSpacing: "-0.025em", marginBottom: 8, fontFamily: "'Fraunces',serif" }}>How do people actually work?</h2>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, maxWidth: 600 }}>Decision maps showing where users succeed, struggle, and diverge &mdash; based on what research observed.</p>
      </div>

      <div style={{ display: "flex", gap: 0, background: "rgba(255,255,255,0.04)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", width: "fit-content", marginBottom: 24 }}>
        <button onClick={() => setUserFilter("all")}
          style={{ padding: "7px 16px", fontSize: 11.5, color: userFilter === "all" ? "#7F77DD" : "rgba(255,255,255,0.45)", background: userFilter === "all" ? "rgba(127,119,221,0.12)" : "none", border: "none", borderRight: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 500 }}>All</button>
        {WF_USER_ORDER.map(u => (
          <button key={u} onClick={() => setUserFilter(u)}
            style={{ padding: "7px 16px", fontSize: 11.5, color: userFilter === u ? "#f0f4ff" : "rgba(255,255,255,0.45)", background: userFilter === u ? "rgba(255,255,255,0.1)" : "none", border: "none", borderRight: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontWeight: 500, transition: "all 0.15s ease" }}>{u}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {filteredWfs.map(wf => (
          <WorkflowDiagram key={wf.id} wf={wf}
            collapsed={expandedId !== wf.id}
            onToggle={() => setExpandedId(expandedId === wf.id ? null : wf.id)}
            showUser={userFilter === "all"}/>
        ))}
        {filteredWfs.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.4)", fontSize: 14 }}>No workflows for this user type.</div>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════
export default function PrestoApp() {
  const [searchQuery, setSearchQuery] = useState("");
  const [mainTab, setMainTab] = useState("library");
  const [filterTab, setFilterTab] = useState("domains");
  const [filterDomains, setFilterDomains] = useState([]);
  const [filterUsers, setFilterUsers] = useState([]);
  const [filterThemes, setFilterThemes] = useState([]);
  const [aiResult, setAiResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedStudy, setSelectedStudy] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 9; // 3 rows x 3 columns at default desktop layout

  useEffect(() => { document.title = "SubNote | Presto"; }, []);

  const toggle = (arr, setArr, val) => setArr(prev=>prev.includes(val)?prev.filter(x=>x!==val):[...prev,val]);

  const filtered = useMemo(()=>{
    let s = STUDIES_DATA;
    if (filterDomains.length) s=s.filter(x=>filterDomains.includes(x.domain));
    if (filterUsers.length) s = s.filter(x => filterUsers.includes(x.user));
    if (filterThemes.length) s=s.filter(x=>filterThemes.includes(x.metaTheme));
    return s;
  },[filterDomains,filterUsers,filterThemes]);

  const totalFilters = filterDomains.length+filterUsers.length+filterThemes.length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedStudies = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [filterDomains, filterUsers, filterThemes]);

  const runSearch = () => {
    if (!searchQuery.trim()) return;
    setAiLoading(true); setAiResult(null);
    setTimeout(() => {
      const result = clientSearch(searchQuery);
      setAiResult(result);
      setAiLoading(false);
    }, 400);
  };

  const [scrollToInsight, setScrollToInsight] = useState(null);
  const openStudy = (study, insightId) => { window.scrollTo(0,0); setSelectedStudy(study); setScrollToInsight(insightId || null); };

  const navTabs = [
    {key:"library",label:"Studies"},
    {key:"needs",label:"User Needs"},
    {key:"workflows",label:"Workflows"},
    {key:"usecases",label:"Use Case Evaluator"},
  ];

  const NavBar = () => (
    <div style={{ padding:"0 40px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,background:"rgba(30,32,37,0.97)",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(12px)" }}>
      <div onClick={()=>{ window.scrollTo(0,0); setSelectedStudy(null); setMainTab("library"); }} style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ flexShrink:0 }}>
          <rect width="24" height="24" rx="6" fill="#7F77DD"/>
          <rect x="6" y="6.5" width="12" height="2" rx="1" fill="#fff" opacity="0.3"/>
          <rect x="6" y="10.5" width="12" height="2" rx="1" fill="#fff" opacity="0.55"/>
          <rect x="6" y="14.5" width="12" height="2" rx="1" fill="#fff" opacity="1"/>
          <circle cx="12" cy="15.5" r="2.2" fill="#fff" opacity="1"/>
        </svg>
        <span style={{ fontFamily:"'Fraunces',serif",fontWeight:900,fontSize:15,letterSpacing:"-0.3px" }}><span style={{ color:"#E8E6E0" }}>Sub</span><span style={{ color:"#AFA9EC" }}>Note</span></span>
        <span style={{ color:"#3a3a42",fontFamily:"'DM Sans',sans-serif",fontWeight:300,fontSize:15,margin:"0 6px" }}>|</span>
        <span style={{ fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:15,color:"#AFA9EC",letterSpacing:"-0.2px" }}>Presto</span>
      </div>
      <nav role="navigation" aria-label="Main navigation" style={{ display:"flex",gap:6,alignItems:"center" }}>
        {navTabs.map(tab=>(
          <button key={tab.key} onClick={()=>{ window.scrollTo(0,0); setSelectedStudy(null); setMainTab(tab.key); }}
            style={{ background:mainTab===tab.key?"rgba(255,255,255,0.1)":"none",border:`1px solid ${mainTab===tab.key?"rgba(255,255,255,0.2)":"transparent"}`,color:mainTab===tab.key?"#f0f4ff":"rgba(255,255,255,0.4)",borderRadius:6,padding:"5px 14px",fontSize:12.5,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:500,transition:"all 0.15s ease" }}>{tab.label}</button>
        ))}
      </nav>
    </div>
  );

  if (selectedStudy) {
    return (
      <div style={{ minHeight:"100vh",background:"#1E2025",color:"#f0f4ff",fontFamily:"'DM Sans',sans-serif",position:"relative",zIndex:1 }}>
        <style>{GLOBAL_STYLES}</style>
        <NavBar />
        <div style={{ maxWidth:1320,margin:"0 auto",padding:"0 40px" }}>
          <StudyDetailView study={selectedStudy} scrollToInsight={scrollToInsight} onBack={()=>{ window.scrollTo(0,0); setSelectedStudy(null); setScrollToInsight(null); }}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh",background:"#1E2025",color:"#f0f4ff",fontFamily:"'DM Sans',sans-serif",position:"relative",zIndex:1 }}>
      <style>{GLOBAL_STYLES}</style>
      <NavBar />

      <div style={{ maxWidth:1320,margin:"0 auto",padding:"0 40px 60px" }}>
        {mainTab==="needs"&&<div style={{ paddingTop:40 }}><LatentNeedsDashboard onStudyClick={openStudy}/></div>}
        {mainTab==="workflows"&&<div style={{ paddingTop:40 }}><WorkflowTab /></div>}
        {mainTab==="usecases"&&<div style={{ paddingTop:40 }}><UseCasesTab onStudyClick={openStudy}/></div>}

        {mainTab==="library"&&(
          <div style={{ paddingTop:28,paddingBottom:20 }}>
            <div style={{ textAlign:"center",marginBottom:32 }}>
              <h1 style={{ fontSize:38,fontWeight:900,lineHeight:1.22,fontFamily:"'Fraunces',serif",letterSpacing:"-0.025em",color:"#f0f4ff",margin:"0 0 10px" }}>
                Find an insight
              </h1>
              <p style={{ fontSize:14,color:"rgba(255,255,255,0.65)",lineHeight:1.6,margin:"0 auto 28px",maxWidth:540 }}>
                {Object.values(INSIGHTS_MAP).reduce((n,d) => n + (d.insights?.length || 0), 0)} insights across {STUDIES_DATA.length} studies. Search or browse below.
              </p>
              <div style={{ maxWidth:700,margin:"0 auto 16px" }}>
                <SearchBar value={searchQuery} onChange={setSearchQuery} onSubmit={runSearch} loading={aiLoading}/>
              </div>
              <div style={{ display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center" }}>
                {STARTER_QUERIES.map((q,i)=>(
                  <button key={i} onClick={()=>setSearchQuery(q)} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.85)",borderRadius:20,padding:"6px 14px",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all 0.15s ease" }}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.08)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.04)";}}
                  >{q}</button>
                ))}
              </div>
            </div>

            {aiResult&&<div style={{ maxWidth:860,margin:"0 auto 24px" }}><AIResultPanel result={aiResult} onClose={()=>setAiResult(null)} onQueryClick={q=>{setSearchQuery(q);}} onStudyClick={openStudy}/></div>}

            <div style={{ background:"#252830",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,marginBottom:28,overflow:"hidden" }}>
              <div style={{ display:"flex",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"0 20px" }}>
                {[{key:"domains",label:"Domains"},{key:"users",label:"Users"},{key:"themes",label:"Themes"}].map(tab=>(
                  <button key={tab.key} onClick={()=>setFilterTab(tab.key)} style={{ background:"none",border:"none",color:filterTab===tab.key?"#f0f4ff":"rgba(255,255,255,0.35)",borderBottom:`2px solid ${filterTab===tab.key?"#7F77DD":"transparent"}`,padding:"13px 16px",fontSize:12.5,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:500,marginBottom:-1,transition:"all 0.15s ease" }}>{tab.label}</button>
                ))}
                {totalFilters>0&&<button onClick={()=>{setFilterDomains([]);setFilterUsers([]);setFilterThemes([]);}} style={{ marginLeft:"auto",background:"none",border:"none",color:"rgba(248,113,113,0.7)",fontSize:11.5,cursor:"pointer",fontFamily:"'DM Mono',monospace",alignSelf:"center" }}>Clear {totalFilters}</button>}
              </div>
              <div style={{ padding:"16px 20px" }}>
                {filterTab==="domains"&&<div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>{DOMAIN_KEYS.map(k=><FilterPill key={k} label={DOMAINS[k].label} active={filterDomains.includes(k)} color={DOMAINS[k].color} onClick={()=>toggle(filterDomains,setFilterDomains,k)}/>)}</div>}
                {filterTab==="users"&&<div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>{ALL_USERS.map(u=>{const active=filterUsers.includes(u);return(
                    <button key={u} onClick={()=>toggle(filterUsers,setFilterUsers,u)} style={{ background:active?"rgba(127,119,221,0.15)":"rgba(255,255,255,0.04)",border:`1px solid ${active?"#7F77DD":"rgba(255,255,255,0.1)"}`,color:active?"#7F77DD":"rgba(255,255,255,0.55)",borderRadius:6,padding:"5px 13px",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:500,transition:"all 0.15s ease" }}>{u}</button>
                  );})}</div>}
                {filterTab==="themes"&&<div style={{ display:"flex",flexWrap:"wrap",gap:8 }}>{META_THEMES.map(t=><FilterPill key={t} label={t} active={filterThemes.includes(t)} onClick={()=>toggle(filterThemes,setFilterThemes,t)}/>)}</div>}
              </div>
            </div>

            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
              <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                <span style={{ fontSize:14,fontWeight:600,color:"#f0f4ff" }}>{filtered.length} {filtered.length===1?"study":"studies"}</span>
                {totalFilters>0&&<span style={{ fontSize:12,color:"rgba(255,255,255,0.65)" }}>filtered from {STUDIES_DATA.length}</span>}
              </div>
            </div>

            <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))",gap:14 }}>
              {pagedStudies.map((study)=><StudyCard key={study.id} study={study} onClick={openStudy}/>)}
              {filtered.length===0&&<div style={{ gridColumn:"1/-1",textAlign:"center",padding:"60px 0",color:"rgba(255,255,255,0.55)",fontSize:14 }}>No studies match the current filters.</div>}
            </div>

            {filtered.length > PAGE_SIZE && (
              <div style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:32,paddingTop:24,borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                <button
                  onClick={()=>{ setCurrentPage(p=>Math.max(1,p-1)); window.scrollTo({top:0,behavior:"smooth"}); }}
                  disabled={safePage===1}
                  style={{ padding:"6px 14px",fontSize:12,fontFamily:"'DM Sans',sans-serif",fontWeight:500,color:safePage===1?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.7)",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,cursor:safePage===1?"not-allowed":"pointer",transition:"all 0.15s ease" }}>
                  &larr; Prev
                </button>
                <div style={{ display:"flex",alignItems:"center",gap:6,padding:"0 12px",fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(255,255,255,0.55)",letterSpacing:"0.06em" }}>
                  <span style={{ color:"#7F77DD" }}>{safePage}</span>
                  <span>/</span>
                  <span>{totalPages}</span>
                </div>
                <button
                  onClick={()=>{ setCurrentPage(p=>Math.min(totalPages,p+1)); window.scrollTo({top:0,behavior:"smooth"}); }}
                  disabled={safePage===totalPages}
                  style={{ padding:"6px 14px",fontSize:12,fontFamily:"'DM Sans',sans-serif",fontWeight:500,color:safePage===totalPages?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.7)",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:6,cursor:safePage===totalPages?"not-allowed":"pointer",transition:"all 0.15s ease" }}>
                  Next &rarr;
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", padding:"24px 40px", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:11, color:"rgba(255,255,255,0.25)", fontFamily:"'DM Sans',sans-serif" }}>SubNote Presto</span>
      </div>
    </div>
  );
}
