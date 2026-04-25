// ── Agents View ─────────────────────────────────────────────────────────────
(function(){
const {useState,useEffect} = React;
const D = window.VIGIL_DATA;

const QUICK_COMMANDS = ['vigil status','vigil alerts list --severity critical','vigil rules list --enabled','netstat -an | head -20'];

const TYPE_LABELS = {drain:'Web Drain',linux:'Linux',windows:'Windows',agent:'Agent'};
const TYPE_COLORS_FN = T => ({drain:T.purple,linux:T.amber,windows:T.cyan,agent:T.green});

function AgentsView({onInvestigate}){
  const T=useT();const SC=useSev();
  const [sel,setSel]=useState(()=>D.AGENTS[0]||null);
  const [tab,setTab]=useState('overview');
  const [cmd,setCmd]=useState('');
  const [cmdHistory,setCmdHistory]=useState([]);
  const [cmdSent,setCmdSent]=useState(false);
  const statusColor={online:T.green,stale:T.amber,offline:T.red,unknown:T.txm};
  const typeColor=TYPE_COLORS_FN(T);

  // Keep sel in sync when AGENTS refresh
  useEffect(()=>{
    if(sel&&D.AGENTS.length>0){
      const updated=D.AGENTS.find(a=>a.id===sel.id);
      if(updated) setSel(updated);
    } else if(!sel&&D.AGENTS.length>0){
      setSel(D.AGENTS[0]);
    }
  },[D.AGENTS.length]);

  const fmtDate=d=>d?new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
  const fmtAge=d=>{if(!d)return'—';const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;};
  const fmtDateTime=d=>{if(!d)return'—';const dt=new Date(d);return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+' · '+dt.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});};

  if(!sel) return(
    <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <p style={{color:T.txm,fontFamily:'Inter',fontSize:13}}>No agents registered. Run <span style={{fontFamily:'JetBrains Mono',color:T.cyan}}>vigil agent register</span> on an endpoint.</p>
    </div>
  );

  const agentAlerts=D.ALERTS.filter(a=>a.endpoint_id===sel.id||a.endpoint_id===sel.hostname||a.endpoint_id===sel.name);
  const openAlerts=agentAlerts.filter(a=>a.status==='open');
  const ipHistory=sel.ip_history||[];
  const latestAlert=agentAlerts.length>0?agentAlerts.reduce((a,b)=>a.matched_at>b.matched_at?a:b):null;
  const latestAlertTime=latestAlert?fmtDateTime(latestAlert.matched_at):'—';

  const sendCommand=async()=>{
    if(!cmd.trim())return;
    const c=cmd.trim();
    setCmdHistory(h=>[{cmd:c,ts:new Date(),status:'queued'},...h]);
    setCmd('');
    await window.VIGIL_API.queueCommand(sel.id,c);
    setCmdSent(true);setTimeout(()=>setCmdSent(false),2000);
  };

  const online=D.AGENTS.filter(a=>a.status==='online').length;
  const stale=D.AGENTS.filter(a=>a.status==='stale'||a.status==='unknown').length;
  const offline=D.AGENTS.filter(a=>a.status==='offline').length;

  return(
    <div style={{flex:1,display:'flex',overflow:'hidden'}}>
      <div style={{width:260,borderRight:`1px solid ${T.bd}`,display:'flex',flexDirection:'column',background:T.card,flexShrink:0}}>
        <div style={{padding:'12px 14px',borderBottom:`1px solid ${T.bd}`}}>
          <div style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:12,color:T.tx,marginBottom:8}}>Fleet Overview</div>
          <div style={{display:'flex',gap:8}}>
            {[[online,'online',T.green],[stale,'stale',T.amber],[offline,'offline',T.red]].map(([n,l,c])=>(
              <div key={l} style={{flex:1,textAlign:'center',background:c+'0d',border:`1px solid ${c}22`,borderRadius:7,padding:'6px 4px'}}>
                <div style={{fontFamily:'JetBrains Mono',fontSize:18,fontWeight:500,color:c}}>{n}</div>
                <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',textTransform:'uppercase',letterSpacing:'.07em'}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:6}}>
          {D.AGENTS.map(a=>{
            const isSel=sel?.id===a.id;
            const aAlerts=D.ALERTS.filter(x=>(x.endpoint_id===a.id||x.endpoint_id===a.hostname||x.endpoint_id===a.name)&&x.status==='open').length;
            return(
              <div key={a.id} onClick={()=>{setSel(a);setTab('overview');}}
                style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:8,
                  cursor:'pointer',marginBottom:2,transition:'all .12s',
                  background:isSel?T.cyan+'10':'transparent',
                  border:`1px solid ${isSel?T.cyan+'33':'transparent'}`}}
                onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background=T.el;}}
                onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background='transparent';}}>
                <div style={{width:8,height:8,borderRadius:'50%',flexShrink:0,
                  background:statusColor[a.status],
                  boxShadow:a.status==='online'?`0 0 5px ${T.green}`:'none',
                  animation:a.status==='online'?'pdot 2.5s infinite':'none'}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,color:isSel?T.cyan:T.tx,fontFamily:'Space Grotesk',fontWeight:isSel?600:400,
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.hostname}</div>
                  <div style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono',marginTop:1}}>
                    {a.type==='drain' ? `web drain · ${a.name}` : `${a.os.split(' ')[0]} · ${a.ip}`}
                  </div>
                </div>
                {aAlerts>0&&<span style={{fontSize:9,fontFamily:'JetBrains Mono',
                  color:aAlerts>10?T.red:T.amber,background:(aAlerts>10?T.red:T.amber)+'14',
                  border:`1px solid ${(aAlerts>10?T.red:T.amber)}33`,
                  borderRadius:4,padding:'1px 5px',flexShrink:0}}>{aAlerts}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
        <div style={{padding:'12px 18px',borderBottom:`1px solid ${T.bd}`,
          background:T.card,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:10,height:10,borderRadius:'50%',
              background:statusColor[sel.status],
              boxShadow:sel.status==='online'?`0 0 7px ${T.green}`:'none',
              animation:sel.status==='online'?'pdot 2.5s infinite':'none',flexShrink:0}}/>
            <span style={{fontFamily:'Space Grotesk',fontWeight:700,fontSize:16,color:T.tx}}>{sel.hostname}</span>
            <span style={{fontSize:10,fontFamily:'JetBrains Mono',color:statusColor[sel.status]||T.txm,
              background:(statusColor[sel.status]||T.txm)+'12',border:`1px solid ${statusColor[sel.status]||T.txm}33`,
              borderRadius:5,padding:'2px 8px',textTransform:'capitalize'}}>{sel.status}</span>
            <span style={{fontSize:10,fontFamily:'JetBrains Mono',color:typeColor[sel.type]||T.txm,
              background:(typeColor[sel.type]||T.txm)+'10',border:`1px solid ${typeColor[sel.type]||T.txm}22`,
              borderRadius:5,padding:'2px 8px',textTransform:'uppercase',letterSpacing:'.06em'}}>
              {TYPE_LABELS[sel.type]||'Agent'}
            </span>
            {sel.type!=='drain'&&<span style={{fontSize:10,fontFamily:'JetBrains Mono',color:T.cyan,
              background:T.cyan+'10',border:`1px solid ${T.cyan}22`,borderRadius:5,padding:'2px 8px'}}>v{sel.version}</span>}
            <span style={{marginLeft:'auto',fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>
              Last seen: {fmtAge(sel.last_seen)}
            </span>
          </div>
        </div>

        <div style={{display:'flex',gap:0,borderBottom:`1px solid ${T.bd}`,
          background:T.card,flexShrink:0,padding:'0 18px'}}>
          {[['overview','Overview',0],['alerts','Alerts',openAlerts.length],
            ['iphistory','IP History',0],['commands','Commands',0]].map(([id,label,badge])=>(
            <div key={id} onClick={()=>setTab(id)}
              style={{padding:'10px 14px',cursor:'pointer',fontSize:12,
                fontFamily:'Space Grotesk',fontWeight:tab===id?600:400,
                color:tab===id?T.cyan:T.txm,
                borderBottom:tab===id?`2px solid ${T.cyan}`:'2px solid transparent',
                marginBottom:-1,transition:'all .12s',display:'flex',alignItems:'center',gap:5}}>
              {label}
              {badge>0&&<span style={{fontSize:9,fontFamily:'JetBrains Mono',color:T.red,
                background:'rgba(248,81,73,.12)',border:'1px solid rgba(248,81,73,.3)',
                borderRadius:4,padding:'0 4px'}}>{badge}</span>}
            </div>
          ))}
        </div>

        <div style={{flex:1,overflowY:'auto',padding:16}}>

          {tab==='overview'&&(
            <div style={{display:'flex',gap:12}}>
              <div style={{flex:1,display:'flex',flexDirection:'column',gap:10}}>
                <Card style={{padding:14}}>
                  <SectionHead title={sel.type==='drain'?'Service Information':'System Information'}/>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'10px 16px'}}>
                    {(sel.type==='drain'
                      ? [
                          ['Type','Web Drain'],
                          ['App Name',sel.name],
                          ['Source','vercel-drain'],
                          ['Endpoint ID',sel.id],
                          ['Registered',sel.created_at?fmtDate(sel.created_at):'—'],
                          ['Total Alerts',agentAlerts.length||0],
                          ['Latest Alert',latestAlertTime],
                        ]
                      : [
                          ['OS',sel.os],['Hostname',sel.hostname],['IP Address',sel.ip],
                          ['Agent Version',sel.version],['Agent ID',sel.id],
                          ['Last Heartbeat',fmtDateTime(sel.last_seen)],
                          ['Latest Alert',latestAlertTime],
                        ]
                    ).map(([k,v])=>(
                      <div key={k}>
                        <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                          textTransform:'uppercase',letterSpacing:'.08em',marginBottom:2}}>{k}</div>
                        <div style={{fontSize:11,color:T.tx,fontFamily:'JetBrains Mono',
                          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {sel.type==='drain'&&(
                    <div style={{marginTop:12,padding:'8px 10px',background:T.bg,borderRadius:7,
                      border:`1px solid ${T.purple}22`}}>
                      <div style={{fontSize:9,color:T.purple,fontFamily:'Space Grotesk',fontWeight:700,
                        textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>Configuration</div>
                      <div style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',lineHeight:1.7}}>
                        Link events: add <span style={{color:T.cyan}}>?endpoint_id={sel.id}</span> to drain URL
                      </div>
                      <div style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',lineHeight:1.7}}>
                        Or set env: <span style={{color:T.cyan}}>VIGIL_DRAIN_ENDPOINT_ID={sel.id}</span>
                      </div>
                    </div>
                  )}
                </Card>

                {sel.cpu>0&&(
                  <Card style={{padding:14}}>
                    <SectionHead title="Resource Usage"/>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                      {[['CPU',sel.cpu,T.cyan,'%'],['RAM',sel.ram,T.purple,'%'],['Disk Free',sel.disk_free_gb||'—',T.green,'GB']].map(([l,v,c,unit])=>(
                        <div key={l}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                            <span style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600}}>{l}</span>
                            <span style={{fontSize:11,color:c,fontFamily:'JetBrains Mono',fontWeight:500}}>{v}{unit}</span>
                          </div>
                          {typeof v==='number'&&<div style={{height:6,background:T.bd,borderRadius:3}}>
                            <div style={{width:`${v}%`,height:'100%',borderRadius:3,
                              boxShadow:`0 0 6px ${c}66`,
                              background:v>80?T.red:v>60?T.amber:c}}/>
                          </div>}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <Card style={{padding:14}}>
                  <SectionHead title="Alert Summary"
                    right={<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{agentAlerts.length} total</span>}/>
                  <div style={{display:'flex',gap:8}}>
                    {['critical','high','medium','low'].map(s=>{
                      const n=agentAlerts.filter(a=>a.severity===s).length;
                      return(
                        <div key={s} onClick={()=>setTab('alerts')}
                          style={{flex:1,textAlign:'center',background:SC[s]+'0d',
                            border:`1px solid ${SC[s]}22`,borderRadius:8,padding:'8px 4px',cursor:'pointer',
                            transition:'all .12s'}}
                          onMouseEnter={e=>e.currentTarget.style.background=SC[s]+'1e'}
                          onMouseLeave={e=>e.currentTarget.style.background=SC[s]+'0d'}>
                          <div style={{fontFamily:'JetBrains Mono',fontSize:20,fontWeight:500,color:SC[s]}}>{n}</div>
                          <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',textTransform:'capitalize'}}>{s}</div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {tab==='alerts'&&(
            <Card style={{padding:14}}>
              <SectionHead title={`Alerts — ${sel.hostname}`}
                right={<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{agentAlerts.length} total</span>}/>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${T.bd}`}}>
                    {['Time','Rule','Severity','Status',''].map(h=>(
                      <th key={h} style={{textAlign:'left',padding:'4px 10px',fontSize:9,fontFamily:'Space Grotesk',
                        fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:T.txm}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentAlerts.length===0&&(
                    <tr><td colSpan={5} style={{padding:'20px',textAlign:'center',color:T.txm,fontSize:11}}>No alerts for this agent</td></tr>
                  )}
                  {agentAlerts.map(a=>(
                    <tr key={a.id} style={{borderBottom:`1px solid ${T.bd}`,cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.background=T.el}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'7px 10px',fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,whiteSpace:'nowrap'}}>
                        {a.matched_at.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false})}</td>
                      <td style={{padding:'7px 10px',color:T.tx,maxWidth:280,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.rule_name}</td>
                      <td style={{padding:'7px 10px'}}><SevBadge sev={a.severity}/></td>
                      <td style={{padding:'7px 10px'}}>
                        <span style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,
                          color:a.status==='open'?T.amber:a.status==='resolved'?T.green:T.txm,
                          textTransform:'capitalize'}}>{a.status}</span>
                      </td>
                      <td style={{padding:'7px 10px'}}>
                        <button onClick={()=>onInvestigate&&onInvestigate(a)}
                          style={{fontSize:9,fontFamily:'Space Grotesk',color:T.cyan,background:'transparent',
                            border:`1px solid ${T.cyan}33`,borderRadius:4,padding:'2px 7px',cursor:'pointer'}}>Investigate</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {tab==='iphistory'&&(
            <Card style={{padding:14}}>
              <SectionHead title="IP Address History"
                right={<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{ipHistory.length} addresses seen</span>}/>
              {ipHistory.length===0&&<p style={{fontSize:11,color:T.txm}}>No IP history recorded</p>}
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {ipHistory.map((h,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 12px',
                    background:i===0?T.cyan+'08':T.bg,border:`1px solid ${i===0?T.cyan+'22':T.bd}`,borderRadius:8}}>
                    <div style={{width:8,height:8,borderRadius:'50%',
                      background:i===0?T.cyan:T.txm,flexShrink:0,
                      boxShadow:i===0?`0 0 6px ${T.cyan}`:'none'}}/>
                    <span style={{fontFamily:'JetBrains Mono',fontSize:13,color:i===0?T.cyan:T.tx,fontWeight:i===0?500:400,flex:1}}>{h.ip}</span>
                    {i===0&&<span style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,
                      background:T.cyan+'12',border:`1px solid ${T.cyan}33`,borderRadius:4,padding:'2px 6px'}}>current</span>}
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>First seen</div>
                      <div style={{fontSize:10,color:T.tx,fontFamily:'JetBrains Mono'}}>{fmtDate(h.first_seen)}</div>
                    </div>
                    <div style={{textAlign:'right',minWidth:100}}>
                      <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600,textTransform:'uppercase',letterSpacing:'.07em'}}>Last seen</div>
                      <div style={{fontSize:10,color:T.tx,fontFamily:'JetBrains Mono'}}>{fmtDate(h.last_seen)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab==='commands'&&(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <Card style={{padding:14}}>
                <SectionHead title="Queue Command"
                  right={<span style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono'}}>delivered on next heartbeat</span>}/>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <div style={{flex:1,display:'flex',alignItems:'center',gap:6,
                    background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,padding:'4px 10px'}}>
                    <span style={{fontSize:12,color:T.cyan,fontFamily:'JetBrains Mono',flexShrink:0}}>$</span>
                    <input value={cmd} onChange={e=>setCmd(e.target.value)}
                      onKeyDown={e=>e.key==='Enter'&&sendCommand()}
                      placeholder="vigil status  /  netstat -an  /  any shell command…"
                      style={{flex:1,background:'transparent',border:'none',outline:'none',
                        color:T.tx,fontFamily:'JetBrains Mono',fontSize:12,padding:'5px 0'}}/>
                  </div>
                  <button onClick={sendCommand}
                    style={{fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,color:T.bg,
                      background:T.cyan,border:'none',borderRadius:8,padding:'0 16px',
                      cursor:'pointer',transition:'opacity .15s',whiteSpace:'nowrap'}}
                    onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
                    onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                    Queue →
                  </button>
                </div>
                {cmdSent&&<div style={{fontSize:10,color:T.green,fontFamily:'Space Grotesk',fontWeight:500,marginBottom:6}}>✓ Command queued — will deliver on next heartbeat</div>}
                <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                  <span style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',alignSelf:'center'}}>Quick:</span>
                  {QUICK_COMMANDS.map(c=>(
                    <button key={c} onClick={()=>setCmd(c)}
                      style={{fontSize:10,fontFamily:'JetBrains Mono',color:T.txm,
                        background:T.el,border:`1px solid ${T.bd}`,borderRadius:5,
                        padding:'3px 8px',cursor:'pointer'}}>{c}</button>
                  ))}
                </div>
              </Card>

              <Card style={{padding:14}}>
                <SectionHead title="Command History"
                  right={cmdHistory.length>0&&<button onClick={()=>setCmdHistory([])}
                    style={{fontSize:10,color:T.txm,background:'transparent',border:T.cardBorder,
                      borderRadius:5,padding:'2px 8px',cursor:'pointer'}}>Clear</button>}/>
                {cmdHistory.length===0&&(
                  <p style={{fontSize:11,color:T.txm,fontFamily:'Inter',fontStyle:'italic'}}>No commands sent this session</p>
                )}
                {cmdHistory.map((h,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 10px',
                    background:T.bg,border:`1px solid ${T.bd}`,borderRadius:7,marginBottom:5}}>
                    <span style={{fontFamily:'JetBrains Mono',fontSize:11,color:T.cyan}}>$</span>
                    <span style={{fontFamily:'JetBrains Mono',fontSize:11,color:T.tx,flex:1}}>{h.cmd}</span>
                    <span style={{fontSize:9,color:T.amber,fontFamily:'Space Grotesk',fontWeight:600,
                      background:T.amber+'12',border:`1px solid ${T.amber}33`,borderRadius:4,padding:'2px 6px'}}>{h.status}</span>
                    <span style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono'}}>
                      {h.ts.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}
                    </span>
                  </div>
                ))}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.AgentsView = AgentsView;
})();
