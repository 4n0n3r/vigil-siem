// ── Hunt View ───────────────────────────────────────────────────────────────
(function(){
const {useState,useRef,useEffect} = React;
const D = window.VIGIL_DATA;

const FIELD_HINTS = ['source:','severity:','process:','user:','host:','src_ip:','event_type:','cmdline:'];

function HuntView(){
  const T=useT();const SC=useSev();
  const [query,setQuery]=useState('');
  const [submitted,setSubmitted]=useState('');
  const [results,setResults]=useState(null);
  const [loading,setLoading]=useState(false);
  const [hint,setHint]=useState(null);
  const [expandedRow,setExpandedRow]=useState(null);
  const [aiQuery,setAiQuery]=useState('');
  const [aiLoading,setAiLoading]=useState(false);
  const inputRef=useRef(null);

  const runSearch=async(q)=>{
    const searchQ=q||query;
    if(!searchQ.trim())return;
    setSubmitted(searchQ);setLoading(true);setResults(null);setExpandedRow(null);
    try{
      const r=await window.VIGIL_API.hunt(searchQ);
      setResults(r);
    }catch(e){
      setResults({events:[],total:0,query_time_ms:0,query:searchQ});
    }
    setLoading(false);
  };

  const askAI=async()=>{
    setAiLoading(true);
    try{
      const r=await window.claude.complete(`You are a threat hunting assistant for a SIEM. Suggest a precise hunt query for: "${aiQuery}"\n\nRespond with:\n1. The query string (using field:value syntax, e.g. "process:powershell user:root")\n2. What to look for in results (2 sentences)\n3. False positive considerations (1 sentence)\n\nBe specific and technical.`);
      const lines=r.split('\n').filter(l=>l.trim());
      const qLine=lines.find(l=>l.match(/[a-z]+:[a-z]/i))||lines[0]||'';
      const cleanQ=qLine.replace(/^[0-9\.\-\*]+\s*/,'').replace(/^query:?\s*/i,'').trim();
      setQuery(cleanQ||r.substring(0,60));
      setAiQuery('');
    }catch{setAiQuery('');}
    setAiLoading(false);
  };

  const handleKey=e=>{
    if(e.key==='Enter')runSearch();
    if(e.key==='Tab'&&hint){e.preventDefault();setQuery(q=>q.replace(/\S*$/,hint+' '));setHint(null);}
    if(e.key==='Escape')setHint(null);
  };

  const handleInput=e=>{
    const v=e.target.value;setQuery(v);
    const last=v.split(/\s+/).pop()||'';
    const match=FIELD_HINTS.find(h=>h.startsWith(last)&&last.length>0&&h!==last);
    setHint(match||null);
  };

  const fmtTime=d=>new Date(d).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});

  const timelineMax=Math.max(...D.HUNT_TIMELINE.map(t=>t.count),1);
  const hours=D.HUNT_TIMELINE.map((t,i)=>({...t,idx:i}));

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',padding:14,gap:10}}>

      <Card style={{padding:16}}>
        <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
          textTransform:'uppercase',letterSpacing:'.1em',marginBottom:8}}>Hunt — Event Search</div>
        <div style={{position:'relative'}}>
          <div style={{display:'flex',gap:8,alignItems:'center',
            background:T.bg,border:`1px solid ${T.cyan}44`,borderRadius:8,padding:'2px 4px 2px 12px',
            boxShadow:`0 0 0 3px ${T.cyan}0a`}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.cyan} strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input ref={inputRef} value={query} onChange={handleInput} onKeyDown={handleKey}
              placeholder='process:powershell  user:root  src_ip:185.220.101.44  severity:critical'
              style={{flex:1,background:'transparent',border:'none',outline:'none',color:T.tx,
                fontFamily:'JetBrains Mono',fontSize:12,padding:'8px 0',lineHeight:1}}/>
            {hint&&<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',flexShrink:0}}>
              Tab → <span style={{color:T.cyan}}>{hint}</span></span>}
            <button onClick={()=>runSearch()} disabled={loading}
              style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:12,color:T.bg,
                background:T.cyan,border:'none',borderRadius:6,padding:'7px 18px',cursor:'pointer',
                flexShrink:0,opacity:loading?0.6:1}}>
              {loading?'Hunting…':'Hunt'}
            </button>
          </div>
          <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
            {[['sudo -i (PrivEsc)','process:bash cmdline:sudo user:root'],
              ['PowerShell download','process:powershell cmdline:DownloadString'],
              ['External IPs','src_ip:185'],
              ['Auth events','event_type:auth'],
              ['All processes','event_type:process_create']].map(([label,q])=>(
              <button key={label} onClick={()=>{setQuery(q);runSearch(q);}}
                style={{fontSize:10,fontFamily:'JetBrains Mono',color:T.txm,
                  background:T.el,border:T.cardBorder,borderRadius:5,
                  padding:'3px 9px',cursor:'pointer',transition:'all .12s'}}
                onMouseEnter={e=>{e.currentTarget.style.color=T.cyan;e.currentTarget.style.borderColor=T.cyan+'44';}}
                onMouseLeave={e=>{e.currentTarget.style.color=T.txm;e.currentTarget.style.borderColor='';}}
              >{label}</button>
            ))}
          </div>
        </div>

        <div style={{marginTop:12,borderTop:T.cardBorder,paddingTop:12}}>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:T.cyan,
              boxShadow:`0 0 5px ${T.cyan}`,animation:'pdot 2s infinite',flexShrink:0}}/>
            <span style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',fontWeight:600}}>Ask AI to build a query</span>
          </div>
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <input value={aiQuery} onChange={e=>setAiQuery(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&aiQuery.trim()&&askAI()}
              placeholder="e.g. find lateral movement attempts from the bastion host"
              style={{flex:1,background:T.bg,border:T.cardBorder,borderRadius:6,
                padding:'7px 12px',color:T.tx,fontFamily:'Inter',fontSize:11,outline:'none'}}/>
            <button onClick={askAI} disabled={!aiQuery.trim()||aiLoading}
              style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,
                background:T.cyan+'14',border:`1px solid ${T.cyan}33`,borderRadius:6,
                padding:'7px 14px',cursor:'pointer',whiteSpace:'nowrap',
                opacity:(!aiQuery.trim()||aiLoading)?0.5:1}}>
              {aiLoading?'Thinking…':'Generate query →'}
            </button>
          </div>
        </div>
      </Card>

      <Card style={{padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,color:T.tx}}>Event Frequency — Last 24h</span>
          <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>total: {D.HUNT_TIMELINE.reduce((s,t)=>s+t.count,0).toLocaleString()} events</span>
        </div>
        <div style={{display:'flex',alignItems:'flex-end',gap:2,height:60}}>
          {hours.map((h,i)=>{
            const pct=(h.count/timelineMax)*100;
            const isHigh=pct>70;
            return(
              <div key={i} title={`${h.ts instanceof Date?h.ts.getHours():i}:00 — ${h.count.toLocaleString()} events`}
                style={{flex:1,height:`${Math.max(pct,3)}%`,borderRadius:'2px 2px 0 0',
                  background:isHigh?T.red:T.cyan,opacity:isHigh?0.9:0.5,
                  transition:'all .2s',cursor:'pointer',boxShadow:isHigh?`0 0 6px ${T.red}55`:''}}
                onMouseEnter={e=>e.currentTarget.style.opacity='1'}
                onMouseLeave={e=>e.currentTarget.style.opacity=isHigh?'0.9':'0.5'}/>
            );
          })}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
          {[0,4,8,12,16,20,23].map(h=>(
            <span key={h} style={{fontSize:8,color:T.txm,fontFamily:'JetBrains Mono'}}>{String(h).padStart(2,'0')}:00</span>
          ))}
        </div>
      </Card>

      {(results||loading)&&(
        <div style={{display:'flex',gap:10,flex:1,minHeight:0}}>
          <Card style={{flex:1,overflow:'hidden',padding:0,display:'flex',flexDirection:'column'}}>
            <div style={{padding:'10px 16px',borderBottom:T.cardBorder,flexShrink:0,display:'flex',gap:10,alignItems:'center'}}>
              {loading?(
                <span style={{fontSize:12,color:T.txm,fontFamily:'JetBrains Mono'}}>Hunting…</span>
              ):(
                <>
                  <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,color:T.tx}}>Results</span>
                  <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm}}>{results.total} events · {results.query_time_ms}ms</span>
                  <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,background:T.cyan+'10',
                    border:`1px solid ${T.cyan}33`,borderRadius:4,padding:'2px 8px',marginLeft:'auto'}}>query: {submitted}</span>
                </>
              )}
            </div>
            <div style={{flex:1,overflowY:'auto'}}>
              {loading&&(
                <div style={{padding:16,display:'flex',flexDirection:'column',gap:8}}>
                  {[1,2,3,4].map(i=><div key={i} className="shimmer-line" style={{height:36,borderRadius:6}}/>)}
                </div>
              )}
              {results&&results.events.length===0&&(
                <div style={{padding:40,textAlign:'center',color:T.txm,fontSize:12,fontFamily:'Inter'}}>
                  No events matched <span style={{fontFamily:'JetBrains Mono',color:T.cyan}}>"{submitted}"</span>
                  <br/><span style={{fontSize:10,marginTop:6,display:'block'}}>Try broadening your query or use AI to generate one</span>
                </div>
              )}
              {results&&results.events.map((e,i)=>(
                <div key={e.id||i}>
                  <div onClick={()=>setExpandedRow(expandedRow===e.id?null:e.id)}
                    style={{display:'grid',gridTemplateColumns:'70px 80px 80px 1fr 90px',
                      gap:0,padding:'8px 16px',cursor:'pointer',transition:'background .1s',
                      borderBottom:T.cardBorder,background:expandedRow===e.id?T.el:'transparent'}}
                    onMouseEnter={ev=>ev.currentTarget.style.background=T.el}
                    onMouseLeave={ev=>ev.currentTarget.style.background=expandedRow===e.id?T.el:'transparent'}>
                    <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,alignSelf:'center'}}>{fmtTime(e.timestamp)}</span>
                    <span style={{fontSize:10,color:T.txm,alignSelf:'center',fontFamily:'JetBrains Mono',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.source}</span>
                    <span style={{fontFamily:'JetBrains Mono',fontSize:11,color:T.tx,alignSelf:'center'}}>{e.event?.process||'—'}</span>
                    <span style={{fontSize:11,color:T.txm,alignSelf:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:8,fontFamily:'JetBrains Mono'}}>{e.event?.cmdline||'—'}</span>
                    <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,alignSelf:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.event?.host||'—'}</span>
                  </div>
                  {expandedRow===e.id&&(
                    <div style={{padding:'10px 16px 12px',background:T.bg,borderBottom:T.cardBorder}}>
                      <pre style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
                        background:T.card,border:T.cardBorder,borderRadius:8,padding:12,
                        overflow:'auto',maxHeight:120,lineHeight:1.6,margin:0}}>
{JSON.stringify(e.event,null,2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div style={{width:220,display:'flex',flexDirection:'column',gap:8,overflowY:'auto'}}>
            {[['Top Processes','top_processes'],['Top Users','top_users'],['Top IPs','top_ips'],['Top Hosts','top_hosts']].map(([title,key])=>{
              const items=(D.HUNT_AGGS[key]||[]).slice(0,6);
              const max=items[0]?.count||1;
              return(
                <Card key={key} style={{padding:12}}>
                  <div style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:11,color:T.tx,marginBottom:8}}>{title}</div>
                  {items.length===0&&<p style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>—</p>}
                  {items.map((item,i)=>(
                    <div key={i} style={{marginBottom:5,cursor:'pointer'}}
                      onClick={()=>{const f=key.replace('top_','').replace(/s$/,'');setQuery(q=>q+` ${f}:${item.value}`);}}
                      title="Click to add to query">
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                        <span style={{fontSize:10,fontFamily:'JetBrains Mono',color:T.tx,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'75%'}}>{item.value}</span>
                        <span style={{fontSize:10,fontFamily:'JetBrains Mono',color:T.cyan,flexShrink:0}}>{item.count}</span>
                      </div>
                      <div style={{height:2,background:T.bd,borderRadius:1}}>
                        <div style={{width:`${(item.count/max)*100}%`,height:'100%',background:T.cyan+'88',borderRadius:1}}/>
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

window.HuntView = HuntView;
})();
