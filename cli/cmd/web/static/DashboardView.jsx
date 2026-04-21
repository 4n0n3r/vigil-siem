// ── Dashboard View ──────────────────────────────────────────────────────────
(function(){
const {useState,useEffect,useRef} = React;
const D = window.VIGIL_DATA;

function AlertTimeline({range}){
  const T=useT();
  const data=D.TIMELINE;
  if(!data||data.length<2) return(
    <Card style={{padding:16,flex:1,minWidth:0}}>
      <SectionHead title="Event Volume — 7 Days"/>
      <div style={{height:130,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <span style={{fontSize:11,color:T.txm,fontFamily:'JetBrains Mono'}}>Collecting data…</span>
      </div>
    </Card>
  );
  const W=100,H=100;
  const vals=data.map(d=>d.v);
  const maxV=Math.max(...vals,1);
  const pts=vals.map((v,i)=>[(i/(vals.length-1))*W,H-(v/maxV)*(H-8)-4]);
  const line='M '+pts.map(p=>`${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ');
  const area=line+` L ${W} ${H} L 0 ${H} Z`;
  const peakAlerts=Math.max(...data.map(d=>d.alerts||0));
  const days=[];
  for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d.toLocaleDateString('en-US',{month:'short',day:'numeric'}));}
  return (
    <Card style={{padding:16,flex:1,minWidth:0}}>
      <SectionHead title="Event Volume — 7 Days"
        right={<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>peak {peakAlerts} alerts/slot</span>}/>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{width:'100%',height:130,display:'block'}}>
        <defs>
          <linearGradient id="tlg2" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={T.cyan} stopOpacity=".2"/>
            <stop offset="100%" stopColor={T.cyan} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[.25,.5,.75].map(t=>(
          <line key={t} x1="0" y1={(H-t*(H-8)-4).toFixed(1)} x2={W}
            y2={(H-t*(H-8)-4).toFixed(1)} stroke={T.bd} strokeWidth=".5" strokeDasharray="2 2"/>
        ))}
        <path d={area} fill="url(#tlg2)"/>
        <path d={line} fill="none" stroke={T.cyan} strokeWidth=".8"
          strokeLinejoin="round" strokeLinecap="round"/>
        <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="1.5"
          fill={T.cyan} style={{filter:`drop-shadow(0 0 4px ${T.cyan})`}}/>
      </svg>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
        {days.map(d=><span key={d} style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono'}}>{d}</span>)}
      </div>
    </Card>
  );
}

function SeverityDonut({alerts}){
  const T=useT();const SC=useSev();
  const counts={critical:0,high:0,medium:0,low:0};
  alerts.filter(a=>a.status==='open').forEach(a=>{counts[a.severity]=(counts[a.severity]||0)+1;});
  const total=Object.values(counts).reduce((s,v)=>s+v,0);
  const sevs=['critical','high','medium','low'];
  const R=38,r=26,cx=50,cy=50;
  let sa=-Math.PI/2;
  const arcs=sevs.map(s=>{
    const c=SC[s];const frac=total?counts[s]/total:0;const angle=frac*2*Math.PI;
    if(!frac)return{path:'',c,label:s,count:0};
    const x1=cx+R*Math.cos(sa),y1=cy+R*Math.sin(sa);
    const x2=cx+R*Math.cos(sa+angle),y2=cy+R*Math.sin(sa+angle);
    const x3=cx+r*Math.cos(sa+angle),y3=cy+r*Math.sin(sa+angle);
    const x4=cx+r*Math.cos(sa),y4=cy+r*Math.sin(sa);
    const lf=angle>Math.PI?1:0;
    const path=`M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R},0,${lf},1,${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${r},${r},0,${lf},0,${x4.toFixed(2)},${y4.toFixed(2)} Z`;
    sa+=angle;return{path,c,label:s,count:counts[s]};
  });
  return (
    <Card style={{padding:16,width:188,flexShrink:0}}>
      <SectionHead title="Severity Split"/>
      <div style={{display:'flex',justifyContent:'center',marginBottom:8}}>
        <svg viewBox="0 0 100 100" width={108} height={108}>
          {arcs.map((a,i)=>a.path?<path key={i} d={a.path} fill={a.c}
            style={{filter:a.label==='critical'&&a.count>0?`drop-shadow(0 0 4px ${SC.critical})`:'none'}}/>:null)}
          {total===0&&<circle cx="50" cy="50" r="38" fill="none" stroke={T.bd} strokeWidth="12"/>}
          <text x="50" y="47" textAnchor="middle" fill={T.tx} fontSize="13"
            fontFamily="JetBrains Mono" fontWeight="500">{total}</text>
          <text x="50" y="58" textAnchor="middle" fill={T.txm} fontSize="6.5" fontFamily="Inter">open</text>
        </svg>
      </div>
      {arcs.map((a,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:5}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <div style={{width:7,height:7,borderRadius:2,background:a.c,flexShrink:0}}/>
            <span style={{fontSize:11,color:T.txm,textTransform:'capitalize'}}>{a.label}</span>
          </div>
          <span style={{fontFamily:'JetBrains Mono',fontSize:11,color:a.c,fontWeight:500}}>{a.count}</span>
        </div>
      ))}
    </Card>
  );
}

function AITriagePanel({alerts,onSelectAlert}){
  const T=useT();
  const [sel,setSel]=useState(null);
  const [summary,setSummary]=useState('');
  const [loading,setLoading]=useState(false);
  const [cache,setCache]=useState({});
  const priority=alerts.filter(a=>a.status==='open'&&(a.severity==='critical'||a.severity==='high')).slice(0,8);
  const SC=useSev();

  const analyze=async(a)=>{
    if(cache[a.id]){setSel(a);setSummary(cache[a.id]);return;}
    setSel(a);setSummary('');setLoading(true);
    try{
      const r=await window.claude.complete(`SOC analyst. Triage this security alert concisely.\n\nRule: ${a.rule_name}\nSeverity: ${a.severity.toUpperCase()}\nHost: ${a.endpoint_id}  Process: ${a.event_snapshot.process}  User: ${a.event_snapshot.user}\nSrc IP: ${a.event_snapshot.src_ip}  CMD: ${a.event_snapshot.cmdline}\nMITRE: ${a.event_snapshot.tactic}\n\n1) What happened (2 sentences max). 2) Immediate action. 3) FP likelihood. Be direct and technical.`);
      setSummary(r);setCache(c=>({...c,[a.id]:r}));
    }catch(e){setSummary('Unable to reach local AI agent — check VIGIL_AI_AGENT_URL.');}
    setLoading(false);
  };

  const fmtAge=d=>{const s=Math.floor((Date.now()-d)/1000);if(s<60)return`${s}s`;if(s<3600)return`${Math.floor(s/60)}m`;return`${Math.floor(s/3600)}h`;};

  return (
    <Card style={{padding:16,width:308,flexShrink:0,border:`1px solid ${T.cyan}22`,
      boxShadow:`${T.shadow}, 0 0 40px rgba(0,229,255,.04)`}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
        <div style={{width:6,height:6,borderRadius:'50%',background:T.cyan,
          boxShadow:`0 0 8px ${T.cyan}`,animation:'pdot 2s infinite'}}/>
        <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,color:T.tx}}>AI Triage</span>
        <span style={{marginLeft:'auto',fontSize:9,fontFamily:'JetBrains Mono',color:T.cyan,
          background:T.cyan+'14',border:`1px solid ${T.cyan}33`,borderRadius:4,padding:'2px 7px'}}>local agent</span>
      </div>
      <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
        textTransform:'uppercase',letterSpacing:'.09em',marginBottom:6}}>Critical &amp; High — Open</div>
      {priority.length===0&&(
        <p style={{fontSize:11,color:T.txm,marginBottom:10}}>No critical/high alerts open.</p>
      )}
      <div style={{display:'flex',flexDirection:'column',gap:2,marginBottom:10,maxHeight:175,overflowY:'auto'}}>
        {priority.map(a=>(
          <div key={a.id} onClick={()=>analyze(a)}
            style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',borderRadius:7,cursor:'pointer',
              background:sel?.id===a.id?SC[a.severity]+'10':'transparent',
              border:`1px solid ${sel?.id===a.id?SC[a.severity]+'44':'transparent'}`,transition:'all .12s'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:SC[a.severity],flexShrink:0,
              boxShadow:`0 0 5px ${SC[a.severity]}`}}/>
            <span style={{fontSize:11,color:T.tx,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.rule_name}</span>
            <span style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono',flexShrink:0}}>{fmtAge(a.matched_at)}</span>
            {cache[a.id]&&<span style={{fontSize:9,color:T.cyan,flexShrink:0}}>✓</span>}
          </div>
        ))}
      </div>
      <div style={{background:T.bg,borderRadius:8,border:T.cardBorder,padding:12,minHeight:155}}>
        {!sel&&<p style={{fontSize:11,color:T.txm,textAlign:'center',paddingTop:30,opacity:.6}}>Select an alert above to analyze with your local AI agent</p>}
        {sel&&loading&&(
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:4,height:4,borderRadius:'50%',background:T.cyan,animation:'pdot .7s infinite'}}/>
              <span style={{fontSize:11,color:T.cyan,fontFamily:'JetBrains Mono'}}>analyzing…</span>
            </div>
            {[70,50,62,40].map((w,i)=><div key={i} className="shimmer-line" style={{height:9,borderRadius:4,width:`${w}%`}}/>)}
          </div>
        )}
        {sel&&!loading&&summary&&(
          <div>
            <div style={{display:'flex',gap:5,marginBottom:8,flexWrap:'wrap'}}>
              <SevBadge sev={sel.severity}/>
              <span style={{fontSize:9,fontFamily:'JetBrains Mono',color:T.txm,background:T.el,borderRadius:4,padding:'2px 7px'}}>{sel.endpoint_id}</span>
            </div>
            <p style={{fontSize:11,color:T.tx,lineHeight:1.65,whiteSpace:'pre-wrap'}}>{summary}</p>
            <div style={{marginTop:10,display:'flex',gap:6}}>
              <button onClick={async()=>{await window.VIGIL_API.acknowledgeAlert(sel.id,'');setSel(null);}}
                style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,
                  background:T.cyan+'14',border:`1px solid ${T.cyan}33`,borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>Acknowledge</button>
              <button style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:T.txm,
                background:'transparent',border:T.cardBorder,borderRadius:6,padding:'4px 10px',cursor:'pointer'}}
                onClick={()=>onSelectAlert&&onSelectAlert(sel)}>Full Detail →</button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function TopRules(){
  const T=useT();const SC=useSev();
  if(!D.TOP_RULES||D.TOP_RULES.length===0) return(
    <Card style={{padding:16,flex:1,minWidth:0}}>
      <SectionHead title="Top Rules Firing"/>
      <p style={{fontSize:11,color:T.txm,fontFamily:'JetBrains Mono',marginTop:8}}>No open alerts yet.</p>
    </Card>
  );
  const max=D.TOP_RULES[0].count;
  return (
    <Card style={{padding:16,flex:1,minWidth:0}}>
      <SectionHead title="Top Rules Firing"/>
      {D.TOP_RULES.map((r,i)=>(
        <div key={i} style={{marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
            <span style={{fontSize:11,color:T.tx,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'82%'}}>{r.name}</span>
            <span style={{fontFamily:'JetBrains Mono',fontSize:11,color:SC[r.sev],fontWeight:500,flexShrink:0,marginLeft:8}}>{r.count}</span>
          </div>
          <div style={{height:3,background:T.bd,borderRadius:2,overflow:'hidden'}}>
            <div style={{width:`${(r.count/max)*100}%`,height:'100%',background:SC[r.sev],borderRadius:2,transition:'width .7s ease'}}/>
          </div>
        </div>
      ))}
    </Card>
  );
}

function ConnectorHealth(){
  const T=useT();
  if(!D.CONNECTORS||D.CONNECTORS.length===0) return(
    <Card style={{padding:16,width:220,flexShrink:0}}>
      <SectionHead title="Connectors"/>
      <p style={{fontSize:11,color:T.txm}}>No connectors configured.</p>
    </Card>
  );
  const fmtAge=d=>{if(!d)return'—';const s=Math.floor((Date.now()-d)/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;return`${Math.floor(s/3600)}h ago`;};
  const siemColor={wazuh:T.amber,elastic:T.purple};
  return (
    <Card style={{padding:16,width:220,flexShrink:0}}>
      <SectionHead title="Connectors"/>
      {D.CONNECTORS.map((c,idx)=>(
        <div key={c.id} style={{marginBottom:10,paddingBottom:10,borderBottom:idx!==D.CONNECTORS.length-1?T.cardBorder:'none'}}>
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
            <div style={{width:6,height:6,borderRadius:'50%',flexShrink:0,
              background:c.enabled&&!c.last_error?T.green:c.last_error?T.red:T.txm,
              boxShadow:c.enabled&&!c.last_error?`0 0 5px ${T.green}`:'none',
              animation:c.enabled&&!c.last_error?'pdot 2.5s infinite':'none'}}/>
            <span style={{fontSize:12,color:T.tx,fontFamily:'Space Grotesk',fontWeight:500,flex:1}}>{c.name}</span>
            <span style={{fontSize:9,fontFamily:'JetBrains Mono',color:siemColor[c.siem_type]||T.txm,
              background:(siemColor[c.siem_type]||T.txm)+'14',border:`1px solid ${(siemColor[c.siem_type]||T.txm)}33`,
              borderRadius:4,padding:'1px 5px'}}>{c.siem_type}</span>
          </div>
          {c.last_error?(
            <div style={{fontSize:9,color:T.red,fontFamily:'JetBrains Mono',
              background:T.red+'0a',borderRadius:4,padding:'3px 6px',
              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.last_error}</div>
          ):(
            <div style={{display:'flex',gap:12}}>
              <div>
                <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600,textTransform:'uppercase'}}>Latency</div>
                <div style={{fontSize:10,color:T.cyan,fontFamily:'JetBrains Mono'}}>{c.latency_ms!=null?`${c.latency_ms}ms`:'—'}</div>
              </div>
              <div>
                <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600,textTransform:'uppercase'}}>Polled</div>
                <div style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{fmtAge(c.last_polled)}</div>
              </div>
              <div>
                <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600,textTransform:'uppercase'}}>Imported</div>
                <div style={{fontSize:10,color:T.green,fontFamily:'JetBrains Mono'}}>{(c.alerts_imported||0).toLocaleString()}</div>
              </div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function AgentGrid(){
  const T=useT();const[sel,setSel]=useState(null);
  const sc={online:T.green,stale:T.amber,offline:T.red};
  const fmtAge=d=>{const s=Math.floor((Date.now()-d)/1000);if(s<60)return`${s}s`;if(s<3600)return`${Math.floor(s/60)}m`;return`${Math.floor(s/3600)}h`;};
  return (
    <Card style={{padding:16,flex:'0 0 268px'}}>
      <SectionHead title="Agent Health"
        right={<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{D.AGENTS.filter(a=>a.status==='online').length}/{D.AGENTS.length} online</span>}/>
      {D.AGENTS.length===0&&<p style={{fontSize:11,color:T.txm}}>No agents registered.</p>}
      {D.AGENTS.map(a=>(
        <div key={a.id}>
          <div onClick={()=>setSel(sel?.id===a.id?null:a)}
            style={{display:'flex',alignItems:'center',gap:8,padding:'5px 6px',borderRadius:7,cursor:'pointer',
              background:sel?.id===a.id?T.el:'transparent',
              border:`1px solid ${sel?.id===a.id?T.bd:'transparent'}`,transition:'all .12s',marginBottom:2}}
            onMouseEnter={e=>{if(sel?.id!==a.id)e.currentTarget.style.background=T.el;}}
            onMouseLeave={e=>{if(sel?.id!==a.id)e.currentTarget.style.background='transparent';}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:sc[a.status],flexShrink:0,
              boxShadow:a.status==='online'?`0 0 6px ${T.green}`:'none',
              animation:a.status==='online'?'pdot 2.5s infinite':'none'}}/>
            <span style={{fontSize:11,color:T.tx,fontFamily:'JetBrains Mono',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.hostname}</span>
            {a.alerts>0&&<span style={{fontSize:9,fontFamily:'JetBrains Mono',
              color:a.alerts>10?T.red:T.amber,background:(a.alerts>10?T.red:T.amber)+'18',
              border:`1px solid ${(a.alerts>10?T.red:T.amber)}33`,borderRadius:4,padding:'1px 5px',flexShrink:0}}>{a.alerts}</span>}
            <span style={{fontSize:9,color:T.txm,flexShrink:0}}>{fmtAge(a.last_seen)}</span>
          </div>
          {sel?.id===a.id&&(
            <div style={{margin:'2px 0 6px',padding:10,background:T.bg,borderRadius:8,border:T.cardBorder}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 12px',marginBottom:a.cpu>0?8:0}}>
                {[['OS',a.os],['IP',a.ip],['Version',a.version],['Status',a.status]].map(([k,v])=>(
                  <div key={k}><div style={{fontSize:8,color:T.txm,textTransform:'uppercase',fontFamily:'Space Grotesk',fontWeight:700,letterSpacing:'.07em'}}>{k}</div>
                  <div style={{fontSize:11,color:T.tx,fontFamily:'JetBrains Mono',marginTop:1}}>{v}</div></div>
                ))}
              </div>
              {a.cpu>0&&[['CPU',a.cpu,T.cyan],['RAM',a.ram,T.purple]].map(([lbl,val,clr])=>(
                <div key={lbl} style={{marginBottom:4}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                    <span style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600}}>{lbl}</span>
                    <span style={{fontSize:9,color:clr,fontFamily:'JetBrains Mono'}}>{val}%</span>
                  </div>
                  <div style={{height:3,background:T.bd,borderRadius:2}}>
                    <div style={{width:`${val}%`,height:'100%',background:clr,borderRadius:2,boxShadow:`0 0 4px ${clr}66`}}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function AlertDropdown({alert,onViewFull,onDismiss,T,SC}){
  const snap=alert.event_snapshot;
  const statusColor={open:T.amber,acknowledged:T.txm,resolved:T.green};
  const doAction=async(action)=>{
    if(action==='Acknowledge') await window.VIGIL_API.acknowledgeAlert(alert.id,'');
    else if(action==='Resolve') await window.VIGIL_API.batchAlerts([alert.id],'resolve');
    onDismiss();
  };
  return(
    <tr>
      <td colSpan={8} style={{padding:0,borderBottom:`1px solid ${T.bd}`}}>
        <div className="anim-in" style={{padding:'12px 14px 14px 42px',background:T.el,
          borderLeft:`3px solid ${SC[alert.severity]}`}}>
          <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
            <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px 16px'}}>
              {[
                ['Host',snap.host||alert.endpoint_id],
                ['User',snap.user],
                ['Process',snap.process],
                ['Src IP',snap.src_ip],
                ['Dst IP',snap.dst_ip||'—'],
                ['PID',snap.pid],
                ['MITRE',snap.tactic],
                ['Status',alert.status],
              ].map(([k,v])=>(
                <div key={k}>
                  <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                    textTransform:'uppercase',letterSpacing:'.08em'}}>{k}</div>
                  <div style={{fontSize:11,color:k==='Status'?statusColor[alert.status]:T.tx,
                    fontFamily:'JetBrains Mono',marginTop:2,overflow:'hidden',
                    textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{String(v)}</div>
                </div>
              ))}
            </div>
            <div style={{width:280,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
              <div>
                <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                  textTransform:'uppercase',letterSpacing:'.08em',marginBottom:3}}>Command</div>
                <div style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
                  background:T.bg,border:`1px solid ${T.bd}`,borderRadius:6,padding:'5px 8px',
                  overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                  title={snap.cmdline}>{snap.cmdline||'—'}</div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[['Acknowledge',T.green],['Resolve',T.txm]].map(([lbl,c])=>(
                  <button key={lbl} onClick={()=>doAction(lbl)}
                    style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,color:c,
                      background:c+'12',border:`1px solid ${c}33`,borderRadius:6,
                      padding:'4px 10px',cursor:'pointer',transition:'background .12s'}}
                    onMouseEnter={e=>e.currentTarget.style.background=c+'22'}
                    onMouseLeave={e=>e.currentTarget.style.background=c+'12'}>
                    {lbl}
                  </button>
                ))}
                <button onClick={onViewFull}
                  style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,
                    background:T.cyan+'14',border:`1px solid ${T.cyan}44`,borderRadius:6,
                    padding:'4px 12px',cursor:'pointer',marginLeft:'auto',transition:'background .12s'}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.cyan+'24'}
                  onMouseLeave={e=>e.currentTarget.style.background=T.cyan+'14'}>
                  View Full Alert →
                </button>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function RecentAlerts({onSelect,onInvestigate}){
  const T=useT();const SC=useSev();
  const [filter,setFilter]=useState('open');
  const [selected,setSelected]=useState(new Set());
  const [expanded,setExpanded]=useState(null);
  const rows=D.ALERTS.filter(a=>filter==='all'||a.status===filter).slice(0,12);
  const fmtTime=d=>d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
  const toggleAll=()=>setSelected(selected.size===rows.length?new Set():new Set(rows.map(r=>r.id)));
  const toggleRow=id=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleExpand=(id)=>setExpanded(e=>e===id?null:id);
  const doBatch=async(action)=>{
    if(selected.size===0)return;
    const ids=[...selected];
    await window.VIGIL_API.batchAlerts(ids,action.toLowerCase());
    setSelected(new Set());
  };

  return (
    <Card style={{padding:16}}>
      <SectionHead title="Recent Alerts"
        right={<>
          {selected.size>0&&(
            <div style={{display:'flex',gap:5,marginRight:4}}>
              <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',marginRight:4}}>{selected.size} selected</span>
              {['Acknowledge','Resolve'].map(a=>(
                <button key={a} onClick={()=>doBatch(a)}
                  style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,color:T.cyan,
                    background:T.cyan+'14',border:`1px solid ${T.cyan}33`,borderRadius:5,
                    padding:'2px 8px',cursor:'pointer'}}>{a}</button>
              ))}
            </div>
          )}
          {['open','acknowledged','all'].map(f=>(
            <Pill key={f} label={f} active={filter===f} onClick={()=>setFilter(f)}/>
          ))}
        </>}/>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
        <thead>
          <tr style={{borderBottom:T.cardBorder}}>
            <th style={{width:32,padding:'4px 8px'}}>
              <input type="checkbox" checked={selected.size===rows.length&&rows.length>0}
                onChange={toggleAll} style={{cursor:'pointer',accentColor:T.cyan}}/>
            </th>
            {['Time','Rule','Severity','Host','Src IP','Status',''].map(h=>(
              <th key={h} style={{textAlign:'left',padding:'4px 10px',fontSize:9,fontFamily:'Space Grotesk',
                fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:T.txm}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length===0&&(
            <tr><td colSpan={8} style={{padding:'20px',textAlign:'center',color:T.txm,fontSize:11}}>No alerts</td></tr>
          )}
          {rows.map(a=>{
            const isOpen=expanded===a.id;
            const rowBg=isOpen?T.cyan+'08':selected.has(a.id)?T.cyan+'08':'transparent';
            return(
              <React.Fragment key={a.id}>
                <tr
                  style={{borderBottom:isOpen?'none':`1px solid ${T.bd}`,cursor:'pointer',
                    transition:'background .1s',background:rowBg}}
                  onClick={e=>{
                    if(e.target.type==='checkbox')return;
                    toggleExpand(a.id);
                  }}
                  onMouseEnter={e=>{ if(!isOpen) e.currentTarget.style.background=T.el; }}
                  onMouseLeave={e=>{ if(!isOpen) e.currentTarget.style.background=rowBg; }}>
                  <td style={{padding:'7px 8px'}} onClick={e=>e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={()=>toggleRow(a.id)}
                      style={{cursor:'pointer',accentColor:T.cyan}}/>
                  </td>
                  <td style={{padding:'7px 10px',fontFamily:'JetBrains Mono',color:T.txm,whiteSpace:'nowrap'}}>
                    {fmtTime(a.matched_at)}
                  </td>
                  <td style={{padding:'7px 10px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                    onClick={e=>{e.stopPropagation();onSelect(a);}}>
                    <span style={{color:T.tx,cursor:'pointer',borderBottom:`1px solid ${T.bd}`,
                      transition:'color .12s,border-color .12s'}}
                      onMouseEnter={e=>{e.currentTarget.style.color=T.cyan;e.currentTarget.style.borderColor=T.cyan;}}
                      onMouseLeave={e=>{e.currentTarget.style.color=T.tx;e.currentTarget.style.borderColor=T.bd;}}>
                      {a.rule_name}
                    </span>
                  </td>
                  <td style={{padding:'7px 10px'}}><SevBadge sev={a.severity}/></td>
                  <td style={{padding:'7px 10px',fontFamily:'JetBrains Mono',fontSize:10,color:T.txm}}>{a.endpoint_id}</td>
                  <td style={{padding:'7px 10px',fontFamily:'JetBrains Mono',fontSize:10,color:T.txm}}>{a.event_snapshot.src_ip}</td>
                  <td style={{padding:'7px 10px'}}>
                    <span style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,
                      color:a.status==='open'?T.amber:a.status==='resolved'?T.green:T.txm,
                      textTransform:'capitalize'}}>{a.status}</span>
                  </td>
                  <td style={{padding:'7px 10px'}}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                      stroke={isOpen?T.cyan:T.txm} strokeWidth="2" strokeLinecap="round"
                      style={{transition:'transform .2s',transform:isOpen?'rotate(180deg)':'rotate(0deg)'}}>
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </td>
                </tr>
                {isOpen&&(
                  <AlertDropdown
                    alert={a}
                    onViewFull={()=>{setExpanded(null);(onInvestigate||onSelect)(a);}}
                    onDismiss={()=>setExpanded(null)}
                    T={T} SC={SC}
                  />
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function DashboardView({range,setRange,onSelectAlert,onInvestigate}){
  const T=useT();const SC=useSev();
  const openCrit=D.ALERTS.filter(a=>a.status==='open'&&a.severity==='critical').length;
  const openHigh=D.ALERTS.filter(a=>a.status==='open'&&a.severity==='high').length;
  const openMed=D.ALERTS.filter(a=>a.status==='open'&&a.severity==='medium').length;
  const openLow=D.ALERTS.filter(a=>a.status==='open'&&a.severity==='low').length;
  return (
    <div style={{flex:1,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',gap:8}}>
        <StatCard label="Critical" value={openCrit} sub="open alerts" color={SC.critical} glow={openCrit>0} pulse={openCrit>0} spark={[2,1,3,5,2,4,openCrit]}/>
        <StatCard label="High" value={openHigh} sub="open alerts" color={SC.high} spark={[3,5,2,8,4,6,openHigh]}/>
        <StatCard label="Medium" value={openMed} sub="open alerts" color={SC.medium} spark={[100,120,90,150,130,110,openMed]}/>
        <StatCard label="Low" value={openLow} sub="open alerts" color={SC.low} spark={[5,8,3,6,9,4,openLow]}/>
        <StatCard label="Agents Online" value={`${D.AGENTS.filter(a=>a.status==='online').length}/${D.AGENTS.length}`} sub="registered" color={T.cyan} spark={[5,5,6,6,5,6,5]}/>
        <StatCard label="Rules Active" value={D.RULES.filter(r=>r.enabled).length} sub="detection rules" color={T.cyan} spark={[8,8,9,9,9,9,D.RULES.filter(r=>r.enabled).length]}/>
      </div>
      <div style={{display:'flex',gap:10}}>
        <AlertTimeline range={range}/>
        <SeverityDonut alerts={D.ALERTS}/>
        <AITriagePanel alerts={D.ALERTS} onSelectAlert={onSelectAlert}/>
      </div>
      <div style={{display:'flex',gap:10}}>
        <TopRules/>
        <AgentGrid/>
        <ConnectorHealth/>
      </div>
      <RecentAlerts onSelect={onSelectAlert} onInvestigate={onInvestigate||onSelectAlert}/>
    </div>
  );
}

window.DashboardView = DashboardView;
})();
