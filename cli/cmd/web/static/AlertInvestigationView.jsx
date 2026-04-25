// ── Alert Investigation View ────────────────────────────────────────────────
(function(){
const {useState,useEffect,useRef} = React;
const D = window.VIGIL_DATA;

const SEV_C_DARK = {critical:'#F85149',high:'#FFB547',medium:'#E6C84A',low:'#3FB950'};

const MITRE = {
  'TA0001':{name:'Initial Access',     icon:'🚪',desc:'Getting a foothold in the network. Look for phishing, exploited public-facing apps, or supply chain compromise.'},
  'TA0002':{name:'Execution',          icon:'⚡',desc:'Running malicious code. Check for script interpreters, scheduled tasks, and service execution.'},
  'TA0003':{name:'Persistence',        icon:'⚓',desc:'Maintaining foothold across restarts. Review startup items, scheduled tasks, and new accounts.'},
  'TA0004':{name:'Privilege Escalation',icon:'⬆',desc:'Gaining higher permissions. Investigate sudo abuse, token manipulation, and setuid binaries.'},
  'TA0005':{name:'Defense Evasion',    icon:'🫥',desc:'Avoiding detection. Look for log clearing, process injection, and masquerading.'},
  'TA0006':{name:'Credential Access',  icon:'🔑',desc:'Stealing credentials. Check LSASS access, credential files, and keyloggers.'},
  'TA0007':{name:'Discovery',          icon:'🔭',desc:'Mapping the environment. Review enumeration commands, network scanning, and cloud service queries.'},
  'TA0008':{name:'Lateral Movement',   icon:'↔',desc:'Moving through the network. Trace remote services, pass-the-hash, and internal spearphishing.'},
  'TA0009':{name:'Collection',         icon:'📦',desc:'Gathering data of interest. Investigate clipboard access, keylogging, and data staged for exfil.'},
  'TA0010':{name:'Exfiltration',       icon:'📤',desc:'Stealing data. Check for large outbound transfers, C2 channels, and scheduled exfil.'},
  'TA0011':{name:'Command & Control',  icon:'📡',desc:'Communicating with compromised systems. Review DNS tunneling, HTTP beaconing, and encrypted channels.'},
  'TA0040':{name:'Impact',             icon:'💥',desc:'Destructive actions. Look for data encryption, wipe commands, and service disruption.'},
};

function genTimeline(alert){
  const base=alert.matched_at.getTime();
  const _gp=window.pickSnap(alert.event_snapshot);
  const types=[
    {type:'auth_success',label:'SSH auth success',color:'#3FB950',icon:'✓',src:_gp.srcIp},
    {type:'process_create',label:`Process: ${_gp.process||'unknown'}`,color:'#FFB547',icon:'⚙',src:null},
    {type:'network_connect',label:'Outbound TCP:443',color:'#A78BFA',icon:'→',src:null},
    {type:'file_write',label:'Write: /tmp/.cache',color:'#FFB547',icon:'📝',src:null},
    {type:'auth_failure',label:'Auth failure (x3)',color:'#F85149',icon:'✗',src:null},
    {type:'process_create',label:'Process: bash -i',color:'#FFB547',icon:'⚙',src:null},
    {type:'network_connect',label:`DNS query: pastebin.com`,color:'#F85149',icon:'⚠',src:null},
  ];
  const events=[];
  const preOffsets=[-28,-22,-18,-14,-10,-7,-4,-2,-1];
  preOffsets.forEach((m,i)=>{
    const t=types[i%types.length];
    events.push({id:`pre-${i}`,ts:new Date(base+m*60000),offsetMin:m,...t,alert:false});
  });
  events.push({id:'trigger',ts:alert.matched_at,offsetMin:0,
    type:'alert',label:alert.rule_name,color:SEV_C_DARK[alert.severity]||'#F85149',
    icon:'⚠',src:_gp.srcIp,alert:true,
    detail:alert.event_snapshot});
  const postOffsets=[1,3,6];
  postOffsets.forEach((m,i)=>{
    const t=types[(i+3)%types.length];
    events.push({id:`post-${i}`,ts:new Date(base+m*60000),offsetMin:m,...t,alert:false});
  });
  return events.sort((a,b)=>a.ts-b.ts);
}

function JsonViewer({data}){
  const T=useT();
  const colorize=(str)=>str
    .replace(/"([^"]+)":/g,`<span style="color:#00E5FF;">"$1":</span>`)
    .replace(/: "([^"]+)"/g,`: <span style="color:#E6C84A;">"$1"</span>`)
    .replace(/: (\d+)/g,`: <span style="color:#A78BFA;">$1</span>`)
    .replace(/: (true|false|null)/g,`: <span style="color:#F85149;">$1</span>`);
  return(
    <pre style={{fontFamily:'JetBrains Mono',fontSize:11,color:T.tx,
      background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,padding:14,
      overflow:'auto',lineHeight:1.65,maxHeight:220,margin:0}}
      dangerouslySetInnerHTML={{__html:colorize(JSON.stringify(data,null,2))}}/>
  );
}

function EventTimeline({events}){
  const T=useT();const SC=useSev();
  const [hov,setHov]=useState(null);
  const [sel,setSel]=useState('trigger');
  const minOff=Math.min(...events.map(e=>e.offsetMin));
  const maxOff=Math.max(...events.map(e=>e.offsetMin));
  const range=maxOff-minOff||1;
  const toX=(m)=>((m-minOff)/range)*92+4;
  const selEvt=events.find(e=>e.id===sel);

  return(
    <Card style={{padding:16}}>
      <SectionHead title="Event Timeline"
        right={<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>±30 min around alert · {events.length} events</span>}/>

      <div style={{position:'relative',height:72,marginBottom:8}}>
        <svg width="100%" height="72" style={{overflow:'visible'}}>
          <line x1="4%" y1="36" x2="96%" y2="36" stroke={T.bd} strokeWidth="1"/>
          <line x1={`${toX(0)}%`} y1="16" x2={`${toX(0)}%`} y2="56"
            stroke={T.red} strokeWidth="1" strokeDasharray="3 2"/>

          {events.map(e=>{
            const x=`${toX(e.offsetMin)}%`;
            const isSel=sel===e.id;const isHov=hov===e.id;
            const r=e.alert?8:isSel?6:5;
            return(
              <g key={e.id} style={{cursor:'pointer'}}
                onMouseEnter={()=>setHov(e.id)} onMouseLeave={()=>setHov(null)}
                onClick={()=>setSel(sel===e.id?null:e.id)}>
                {e.alert&&<circle cx={x} cy="36" r="14" fill={e.color}
                  fillOpacity=".12" style={{filter:`drop-shadow(0 0 8px ${e.color}44)`}}/>}
                <circle cx={x} cy="36" r={r} fill={e.alert?e.color:e.color}
                  stroke={isSel||isHov?'white':'none'} strokeWidth="1.5"
                  style={{filter:e.alert?`drop-shadow(0 0 6px ${e.color})`:''}}/>
                <text x={x} y="62" textAnchor="middle" fill={T.txm}
                  fontSize="8" fontFamily="JetBrains Mono">
                  {e.offsetMin===0?'T':e.offsetMin>0?`+${e.offsetMin}m`:`${e.offsetMin}m`}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{display:'flex',gap:12,position:'absolute',top:0,right:0}}>
          {[['auth','#3FB950'],['process','#FFB547'],['network','#A78BFA'],['alert',T.red]].map(([l,c])=>(
            <div key={l} style={{display:'flex',alignItems:'center',gap:4}}>
              <div style={{width:7,height:7,borderRadius:'50%',background:c}}/>
              <span style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk'}}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {selEvt&&(
        <div className="anim-in" style={{padding:'10px 12px',background:T.bg,borderRadius:8,
          border:`1px solid ${selEvt.alert?selEvt.color+'44':T.bd}`,
          borderLeft:`3px solid ${selEvt.alert?selEvt.color:selEvt.color}`}}>
          <div style={{display:'flex',gap:10,alignItems:'flex-start',justifyContent:'space-between'}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
                <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm}}>
                  {selEvt.ts.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}
                </span>
                {selEvt.alert&&<SevBadge sev={selEvt.type in SEV_C_DARK?selEvt.type:'high'}/>}
              </div>
              <div style={{fontSize:12,color:selEvt.alert?selEvt.color:T.tx,fontFamily:'Space Grotesk',fontWeight:selEvt.alert?600:400}}>{selEvt.label}</div>
              {selEvt.src&&<div style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',marginTop:3}}>src: {selEvt.src}</div>}
            </div>
            {selEvt.detail&&(
              <span style={{fontSize:9,color:T.cyan,fontFamily:'JetBrains Mono',background:T.cyan+'10',
                border:`1px solid ${T.cyan}33`,borderRadius:4,padding:'2px 6px',flexShrink:0}}>trigger event</span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function AIAssistant({alert}){
  const T=useT();
  const [msgs,setMsgs]=useState([]);
  const [input,setInput]=useState('');
  const [loading,setLoading]=useState(false);
  const bottomRef=useRef(null);
  const _ap=window.pickSnap(alert.event_snapshot);
  const alertCtx=_ap.isWeb
    ?`Alert: ${alert.rule_name} (${alert.severity.toUpperCase()}) on ${alert.endpoint_id}\nPath: ${alert.event_snapshot.path} | Method: ${alert.event_snapshot.method} | Status: ${alert.event_snapshot.status_code}\nClient IP: ${_ap.srcIp} | UA: ${alert.event_snapshot.user_agent}\nTime: ${alert.matched_at.toISOString()}`
    :`Alert: ${alert.rule_name} (${alert.severity.toUpperCase()}) on ${alert.endpoint_id}\nProcess: ${_ap.process} | User: ${_ap.user}\nCmd: ${_ap.cmdline}\nSrc IP: ${_ap.srcIp} → Dst: ${_ap.dstIp||'internal'}\nMITRE: ${_ap.tactic} | PID: ${_ap.pid}\nTime: ${alert.matched_at.toISOString()}`;

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      setLoading(true);setMsgs([]);
      try{
        const r=await window.claude.complete(`You are a SOC analyst AI assistant. Provide an initial triage for this security alert.\n\n${alertCtx}\n\nStructure your response as:\n**What happened:** (2-3 sentences explaining the event)\n**Threat assessment:** (likelihood this is malicious, key indicators)\n**Immediate investigation steps:** (3 specific actions, bullet points)\n**Containment:** (what to do if confirmed malicious)\n\nBe direct, technical, and concise.`);
        if(!cancelled) setMsgs([{role:'assistant',text:r,auto:true}]);
      }catch{
        if(!cancelled) setMsgs([{role:'assistant',text:'Unable to reach local AI agent. Check VIGIL_AI_AGENT_URL.',auto:true}]);
      }
      if(!cancelled) setLoading(false);
    })();
    return()=>{cancelled=true;};
  },[alert.id]);

  useEffect(()=>{
    if(bottomRef.current)bottomRef.current.scrollTop=bottomRef.current.scrollHeight;
  },[msgs,loading]);

  const ask=async(q)=>{
    const question=q||input.trim();
    if(!question||loading)return;
    setInput('');
    const newMsgs=[...msgs,{role:'user',text:question}];
    setMsgs(newMsgs);
    setLoading(true);
    try{
      const history=newMsgs.map(m=>`${m.role==='user'?'Analyst':'AI'}: ${m.text}`).join('\n\n');
      const r=await window.claude.complete(`You are a SOC analyst AI assistant. Context:\n${alertCtx}\n\nConversation:\n${history}\n\nProvide a focused, technical response.`);
      setMsgs(m=>[...m,{role:'assistant',text:r}]);
    }catch{
      setMsgs(m=>[...m,{role:'assistant',text:'Request failed. Check agent connection.'}]);
    }
    setLoading(false);
  };

  const SUGGESTIONS=['Is this IP known malicious?','What MITRE technique is this?','Could this be a false positive?','What lateral movement to look for?','Containment checklist?'];

  return(
    <Card style={{display:'flex',flexDirection:'column',padding:0,overflow:'hidden',flex:1,minHeight:0,
      border:`1px solid ${T.cyan}22`,boxShadow:`0 0 30px rgba(0,229,255,.04)`}}>
      <div style={{padding:'12px 14px',borderBottom:`1px solid ${T.bd}`,flexShrink:0,
        display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:6,height:6,borderRadius:'50%',background:T.cyan,
          boxShadow:`0 0 7px ${T.cyan}`,animation:'pdot 2s infinite'}}/>
        <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,color:T.tx}}>AI Investigation</span>
        <span style={{marginLeft:'auto',fontSize:9,fontFamily:'JetBrains Mono',color:T.cyan,
          background:T.cyan+'12',border:`1px solid ${T.cyan}33`,borderRadius:4,padding:'2px 7px'}}>local agent</span>
      </div>

      <div ref={bottomRef} style={{flex:1,overflowY:'auto',padding:12,display:'flex',flexDirection:'column',gap:10,minHeight:0}}>
        {loading&&msgs.length===0&&(
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:4,height:4,borderRadius:'50%',background:T.cyan,animation:'pdot .7s infinite'}}/>
              <span style={{fontSize:11,color:T.cyan,fontFamily:'JetBrains Mono'}}>analyzing alert…</span>
            </div>
            {[82,65,74,55,68].map((w,i)=><div key={i} className="shimmer-line" style={{height:9,borderRadius:4,width:`${w}%`}}/>)}
          </div>
        )}
        {msgs.map((m,i)=>(
          <div key={i} style={{display:'flex',flexDirection:'column',
            alignItems:m.role==='user'?'flex-end':'flex-start'}}>
            {m.role==='user'?(
              <div style={{background:T.cyan+'18',border:`1px solid ${T.cyan}33`,borderRadius:'12px 12px 3px 12px',
                padding:'8px 12px',maxWidth:'85%'}}>
                <p style={{fontSize:12,color:T.tx,lineHeight:1.5,margin:0}}>{m.text}</p>
              </div>
            ):(
              <div style={{background:T.el,border:`1px solid ${T.bd}`,borderRadius:'3px 12px 12px 12px',
                padding:'10px 12px',maxWidth:'100%',width:'100%'}}>
                {m.auto&&<div style={{fontSize:9,color:T.cyan,fontFamily:'Space Grotesk',fontWeight:700,
                  textTransform:'uppercase',letterSpacing:'.08em',marginBottom:6}}>Initial Analysis</div>}
                <p style={{fontSize:11,color:T.tx,lineHeight:1.7,margin:0,whiteSpace:'pre-wrap'}}
                  dangerouslySetInnerHTML={{__html:m.text
                    .replace(/\*\*([^*]+)\*\*/g,`<strong style="color:#00E5FF;">$1</strong>`)
                    .replace(/^- /gm,'• ')}}/>
              </div>
            )}
          </div>
        ))}
        {loading&&msgs.length>0&&(
          <div style={{display:'flex',gap:5,alignItems:'center',padding:'4px 0'}}>
            {[0,1,2].map(i=>(
              <div key={i} style={{width:5,height:5,borderRadius:'50%',background:T.cyan,
                animation:`pdot .8s ${i*.2}s infinite`}}/>
            ))}
          </div>
        )}
      </div>

      {msgs.length>0&&!loading&&(
        <div style={{padding:'6px 12px',borderTop:`1px solid ${T.bd}`,display:'flex',gap:5,flexWrap:'wrap',flexShrink:0}}>
          {SUGGESTIONS.map(s=>(
            <button key={s} onClick={()=>ask(s)}
              style={{fontSize:9,fontFamily:'Space Grotesk',color:T.txm,
                background:T.el,border:`1px solid ${T.bd}`,borderRadius:12,
                padding:'3px 9px',cursor:'pointer',transition:'all .12s',whiteSpace:'nowrap'}}
              onMouseEnter={e=>{e.currentTarget.style.color=T.cyan;e.currentTarget.style.borderColor=T.cyan+'44';}}
              onMouseLeave={e=>{e.currentTarget.style.color=T.txm;e.currentTarget.style.borderColor='';}}>{s}</button>
          ))}
        </div>
      )}

      <div style={{padding:'8px 12px',borderTop:`1px solid ${T.bd}`,flexShrink:0,
        display:'flex',gap:7,alignItems:'center'}}>
        <input value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==='Enter'&&ask()}
          placeholder="Ask anything about this alert…"
          disabled={loading}
          style={{flex:1,background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,
            padding:'7px 10px',color:T.tx,fontFamily:'Inter',fontSize:11,outline:'none',
            opacity:loading?.6:1}}/>
        <button onClick={()=>ask()} disabled={!input.trim()||loading}
          style={{background:T.cyan,border:'none',borderRadius:7,padding:'7px 12px',
            cursor:'pointer',color:'#080B10',fontWeight:700,fontSize:12,
            opacity:(!input.trim()||loading)?.4:1,transition:'opacity .15s'}}>↑</button>
      </div>
    </Card>
  );
}

function HostContext({alert}){
  const T=useT();const SC=useSev();
  const agent=D.AGENTS.find(a=>a.hostname===alert.endpoint_id||a.name===alert.endpoint_id);
  const hostAlerts=D.ALERTS.filter(a=>a.endpoint_id===alert.endpoint_id&&a.id!==alert.id&&a.status==='open').slice(0,4);
  const sc={online:T.green,stale:T.amber,offline:T.red};
  const fmtAge=d=>{const s=Math.floor((Date.now()-d)/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;return`${Math.floor(s/3600)}h ago`;};

  return(
    <Card style={{padding:14,flexShrink:0}}>
      <SectionHead title="Host Context"/>
      {agent?(
        <>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:sc[agent.status]||T.txm,
              boxShadow:agent.status==='online'?`0 0 6px ${T.green}`:'none',
              animation:agent.status==='online'?'pdot 2.5s infinite':'none',flexShrink:0}}/>
            <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,color:T.tx}}>{agent.hostname}</span>
            <span style={{fontSize:9,fontFamily:'JetBrains Mono',color:sc[agent.status]||T.txm,
              background:(sc[agent.status]||T.txm)+'14',border:`1px solid ${(sc[agent.status]||T.txm)}33`,
              borderRadius:4,padding:'2px 6px',marginLeft:'auto'}}>{agent.status}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 12px',marginBottom:10}}>
            {[['OS',agent.os],['IP',agent.ip],['Version',agent.version],['Last seen',fmtAge(agent.last_seen)]].map(([k,v])=>(
              <div key={k}>
                <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em'}}>{k}</div>
                <div style={{fontSize:11,color:T.tx,fontFamily:'JetBrains Mono',marginTop:1}}>{v}</div>
              </div>
            ))}
          </div>
          {agent.cpu>0&&(
            <div style={{display:'flex',gap:10,marginBottom:10}}>
              {[['CPU',agent.cpu,T.cyan],['RAM',agent.ram,T.purple]].map(([l,v,c])=>(
                <div key={l} style={{flex:1}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                    <span style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600}}>{l}</span>
                    <span style={{fontSize:9,color:c,fontFamily:'JetBrains Mono'}}>{v}%</span>
                  </div>
                  <div style={{height:3,background:T.bd,borderRadius:2}}>
                    <div style={{width:`${v}%`,height:'100%',background:c,borderRadius:2,boxShadow:`0 0 4px ${c}55`}}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ):(
        <div style={{fontSize:11,color:T.txm,marginBottom:10}}>Agent not found for host <span style={{fontFamily:'JetBrains Mono',color:T.tx}}>{alert.endpoint_id}</span></div>
      )}

      {hostAlerts.length>0&&(
        <>
          <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
            textTransform:'uppercase',letterSpacing:'.09em',marginBottom:6}}>
            Other open alerts on host ({hostAlerts.length})
          </div>
          {hostAlerts.map(a=>(
            <div key={a.id} style={{display:'flex',alignItems:'center',gap:7,padding:'4px 0',
              borderBottom:`1px solid ${T.bd}`}}>
              <div style={{width:5,height:5,borderRadius:'50%',background:SC[a.severity],flexShrink:0}}/>
              <span style={{fontSize:11,color:T.tx,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.rule_name}</span>
              <SevBadge sev={a.severity}/>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

function InvestigationNotes({alert}){
  const T=useT();
  const [note,setNote]=useState('');
  const [saved,setSaved]=useState(false);

  const save=async()=>{
    await window.VIGIL_API.acknowledgeAlert(alert.id,note);
    setSaved(true);setTimeout(()=>setSaved(false),2000);
  };

  return(
    <Card style={{padding:14,flexShrink:0}}>
      <SectionHead title="Notes & Actions"/>
      <textarea
        value={note} onChange={e=>setNote(e.target.value)}
        placeholder="Add investigation notes… (findings, actions taken, context)"
        style={{width:'100%',minHeight:80,background:T.bg,border:`1px solid ${T.bd}`,
          borderRadius:8,padding:10,color:T.tx,fontFamily:'Inter',fontSize:11,
          lineHeight:1.6,resize:'vertical',outline:'none',boxSizing:'border-box',
          marginBottom:10}}/>
      <button onClick={save}
        style={{width:'100%',fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,
          color:saved?T.green:T.txm,background:saved?T.green+'14':T.el,
          border:`1px solid ${saved?T.green+'44':T.bd}`,borderRadius:7,
          padding:'7px',cursor:'pointer',marginBottom:10,transition:'all .2s'}}>
        {saved?'✓ Acknowledged':'Acknowledge with Note'}
      </button>
      <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
        textTransform:'uppercase',letterSpacing:'.09em',marginBottom:7}}>Resolution</div>
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {[['Acknowledge','Mark as reviewed, keep open','#3FB950','acknowledge'],
          ['Resolve','Mark investigation complete','#00E5FF','resolve']].map(([lbl,desc,c,action])=>(
          <button key={lbl} onClick={async()=>{await window.VIGIL_API.batchAlerts([alert.id],action);}}
            style={{display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'8px 10px',borderRadius:7,cursor:'pointer',
              background:c+'0c',border:`1px solid ${c}33`,transition:'all .12s',textAlign:'left'}}
            onMouseEnter={e=>e.currentTarget.style.background=c+'1e'}
            onMouseLeave={e=>e.currentTarget.style.background=c+'0c'}>
            <div>
              <div style={{fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,color:c}}>{lbl}</div>
              <div style={{fontSize:9,color:T.txm,marginTop:1}}>{desc}</div>
            </div>
            <span style={{fontSize:14,color:c,flexShrink:0}}>→</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function MitreCard({tactic}){
  const T=useT();
  const info=MITRE[tactic]||{name:tactic,icon:'🔎',desc:'Unknown tactic.'};
  return(
    <Card style={{padding:12,flexShrink:0,border:`1px solid ${T.cyan}22`}}>
      <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
        <div style={{fontSize:22,lineHeight:1,flexShrink:0}}>{info.icon}</div>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
            <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
              background:T.cyan+'12',border:`1px solid ${T.cyan}33`,borderRadius:4,
              padding:'2px 6px'}}>{tactic}</span>
            <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:12,color:T.tx}}>{info.name}</span>
          </div>
          <p style={{fontSize:11,color:T.txm,lineHeight:1.55,margin:0}}>{info.desc}</p>
        </div>
      </div>
    </Card>
  );
}

function QuickSuppression({alert}){
  const T=useT();
  const snap=alert.event_snapshot;
  const [open,setOpen]=useState(false);
  const [sel,setSel]=useState(null);
  const [created,setCreated]=useState(null);

  const _sp=window.pickSnap(snap);
  const SUGGESTIONS=_sp.isWeb?[
    {id:'ip',  label:'Client IP',  field_path:'client_ip',  field_value:_sp.srcIp,       match_type:'exact', scope:'global'},
    {id:'path',label:'Path',       field_path:'path',        field_value:snap.path,       match_type:'exact', scope:'global'},
    {id:'ua',  label:'User Agent', field_path:'user_agent',  field_value:snap.user_agent, match_type:'exact', scope:'global'},
    {id:'host',label:'Rule on Host',field_path:'rule_name',  field_value:alert.rule_name, match_type:'exact', scope:alert.endpoint_id},
  ]:[
    {id:'ip',  label:'Src IP',     field_path:'event_data.IpAddress', field_value:_sp.srcIp,   match_type:'exact', scope:'global'},
    {id:'proc',label:'Process',    field_path:'event_data.NewProcessName', field_value:_sp.process, match_type:'contains', scope:'global'},
    {id:'user',label:'User',       field_path:'event_data.TargetUserName', field_value:_sp.user, match_type:'exact', scope:'global'},
    {id:'host',label:'Rule on Host',field_path:'rule_name',  field_value:alert.rule_name, match_type:'exact', scope:alert.endpoint_id},
  ];

  const active=sel?SUGGESTIONS.find(s=>s.id===sel):null;

  const create=async()=>{
    if(!active)return;
    const result=await window.VIGIL_API.createSuppression({
      name:`${active.label}: ${active.field_value}`,
      description:`Quick suppression from alert ${alert.id}`,
      field_path:active.field_path,field_value:active.field_value,
      match_type:active.match_type,scope:active.scope
    });
    if(result) setCreated(result);
    setSel(null);
  };

  if(created) return(
    <Card style={{padding:14,flexShrink:0,border:`1px solid ${T.green}33`}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={{width:7,height:7,borderRadius:'50%',background:T.green,boxShadow:`0 0 6px ${T.green}`}}/>
        <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:12,color:T.green}}>Suppression Created</span>
      </div>
      <div style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,
        background:T.bg,border:`1px solid ${T.bd}`,borderRadius:6,padding:'7px 10px',marginBottom:8}}>
        <div style={{color:T.cyan}}>id: {created.id}</div>
        <div>{created.field_path}: <span style={{color:T.tx}}>{created.field_value}</span></div>
      </div>
      <button onClick={()=>setCreated(null)} style={{fontSize:10,fontFamily:'Space Grotesk',color:T.txm,
        background:'transparent',border:T.cardBorder,borderRadius:6,padding:'4px 10px',cursor:'pointer',width:'100%'}}>
        Create another →
      </button>
    </Card>
  );

  return(
    <Card style={{padding:14,flexShrink:0}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}}>
        <SectionHead title="Quick Suppression" style={{marginBottom:0}}/>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.txm} strokeWidth="2" strokeLinecap="round"
          style={{transform:open?'rotate(180deg)':'rotate(0)',transition:'transform .2s',flexShrink:0}}>
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </div>
      {!open&&<p style={{fontSize:10,color:T.txm,marginTop:4}}>Suppress similar events to reduce noise</p>}

      {open&&(
        <div className="anim-in" style={{marginTop:10}}>
          <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:10}}>
            {SUGGESTIONS.map(s=>(
              <div key={s.id} onClick={()=>setSel(sel===s.id?null:s.id)}
                style={{display:'flex',alignItems:'center',gap:8,padding:'7px 9px',borderRadius:8,cursor:'pointer',
                  background:sel===s.id?T.amber+'10':T.bg,
                  border:`1px solid ${sel===s.id?T.amber+'44':T.bd}`,transition:'all .12s'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,color:sel===s.id?T.tx:T.txm,fontFamily:'Space Grotesk',fontWeight:sel===s.id?500:400}}>{s.label}</div>
                  <div style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.field_value}</div>
                </div>
                <div style={{width:14,height:14,borderRadius:'50%',border:`2px solid ${sel===s.id?T.amber:T.bd}`,
                  background:sel===s.id?T.amber:'transparent',transition:'all .12s',flexShrink:0}}/>
              </div>
            ))}
          </div>

          {sel&&(
            <button onClick={create}
              style={{width:'100%',fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,
                color:T.bg,background:T.amber,border:'none',borderRadius:7,
                padding:'8px',cursor:'pointer',boxShadow:`0 0 12px ${T.amber}44`,transition:'opacity .15s'}}
              onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
              onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
              Create Suppression →
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function AlertInvestigationView({alert,onBack}){
  const T=useT();const SC=useSev();
  const tlEvents=genTimeline(alert);
  const fmtDate=d=>d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const statusColor={open:T.amber,acknowledged:T.txm,resolved:T.green};

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'10px 18px',borderBottom:`1px solid ${T.bd}`,background:T.card,
        flexShrink:0,display:'flex',alignItems:'center',gap:10}}>
        <button onClick={onBack}
          style={{display:'flex',alignItems:'center',gap:5,background:'none',border:'none',
            cursor:'pointer',color:T.txm,fontSize:12,fontFamily:'Space Grotesk',padding:'4px 8px',
            borderRadius:6,transition:'all .12s'}}
          onMouseEnter={e=>e.currentTarget.style.color=T.tx}
          onMouseLeave={e=>e.currentTarget.style.color=T.txm}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          Dashboard
        </button>
        <span style={{color:T.bd}}>›</span>
        <span style={{color:T.txm,fontSize:12,fontFamily:'Space Grotesk'}}>Alerts</span>
        <span style={{color:T.bd}}>›</span>
        <span style={{fontSize:12,color:T.tx,fontFamily:'Space Grotesk',fontWeight:500,
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:280}}>
          {alert.rule_name}
        </span>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>
          <SevBadge sev={alert.severity} size="md"/>
          <span style={{fontSize:11,fontFamily:'Space Grotesk',fontWeight:500,
            color:statusColor[alert.status],textTransform:'capitalize',
            background:(statusColor[alert.status])+'12',
            border:`1px solid ${statusColor[alert.status]}33`,
            borderRadius:5,padding:'3px 9px'}}>{alert.status}</span>
          <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{fmtDate(alert.matched_at)}</span>
          <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',
            background:T.el,borderRadius:4,padding:'2px 7px',border:`1px solid ${T.bd}`}}>ID: {alert.id}</span>
        </div>
      </div>

      <div style={{flex:1,display:'flex',overflow:'hidden',gap:0}}>

        <div style={{flex:1,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10,minWidth:0}}>

          <Card style={{padding:14}}>
            <SectionHead title="Alert Summary"/>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px 16px',marginBottom:12}}>
              {(()=>{const _p=window.pickSnap(alert.event_snapshot);return _p.isWeb?[
                ['Rule',alert.rule_name,'full'],
                ['Host',alert.endpoint_id,null],
                ['Client IP',_p.srcIp||'—',null],
                ['Method',alert.event_snapshot.method||'—',null],
                ['Status',alert.event_snapshot.status_code!=null?String(alert.event_snapshot.status_code):'—',null],
                ['Path',alert.event_snapshot.path||'—',null],
                ['Host Header',alert.event_snapshot.host||'—',null],
                ['UA Type',alert.event_snapshot.ua_category||'—',null],
              ]:[
                ['Rule',alert.rule_name,'full'],
                ['Host',alert.endpoint_id,null],
                ['User',_p.user||'—',null],
                ['Process',_p.process||'—',null],
                ['PID',_p.pid||'—',null],
                ['Src IP',_p.srcIp||'—',null],
                ['Dst IP',_p.dstIp||'internal',null],
                ['MITRE',_p.tactic||'—',null],
              ];})().map(([k,v,span])=>(
                <div key={k} style={span==='full'?{gridColumn:'1 / -1'}:{}}>
                  <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                    textTransform:'uppercase',letterSpacing:'.08em',marginBottom:2}}>{k}</div>
                  <div style={{fontSize:span==='full'?13:12,color:T.tx,fontFamily:'JetBrains Mono',
                    fontWeight:span==='full'?500:400,
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{String(v)}</div>
                </div>
              ))}
            </div>
            <div>
              <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>Command Line</div>
              <div style={{fontFamily:'JetBrains Mono',fontSize:11,color:T.cyan,
                background:T.bg,border:`1px solid ${T.bd}`,borderRadius:7,
                padding:'7px 10px',overflow:'auto',whiteSpace:'nowrap'}}>
                {window.pickSnap(alert.event_snapshot).cmdline||'—'}
              </div>
            </div>
          </Card>

          {window.pickSnap(alert.event_snapshot).tactic&&<MitreCard tactic={window.pickSnap(alert.event_snapshot).tactic}/>}
          <EventTimeline events={tlEvents}/>

          <Card style={{padding:14}}>
            <SectionHead title="Raw Event Snapshot"/>
            <JsonViewer data={alert.event_snapshot}/>
          </Card>
        </div>

        <div style={{width:360,flexShrink:0,borderLeft:`1px solid ${T.bd}`,
          display:'flex',flexDirection:'column',overflow:'hidden',background:T.card}}>
          <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',
            gap:10,padding:12,minHeight:0}}>
            <div style={{flex:'1 1 400px',display:'flex',flexDirection:'column',minHeight:320}}>
              <AIAssistant alert={alert}/>
            </div>
            <HostContext alert={alert}/>
            <QuickSuppression alert={alert}/>
            <InvestigationNotes alert={alert}/>
          </div>
        </div>
      </div>
    </div>
  );
}

window.AlertInvestigationView = AlertInvestigationView;
})();
