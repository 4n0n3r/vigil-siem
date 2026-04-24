// ── Alerts View ──────────────────────────────────────────────────────────────
(function(){
const {useState,useMemo} = React;
const D = window.VIGIL_DATA;
const PAGE_SIZE = 15;

function AlertsView({onInvestigate}){
  const T=useT();const SC=useSev();
  const [sevFilter,setSevFilter]=useState([]);
  const [statusFilter,setStatusFilter]=useState('open');
  const [hostFilter,setHostFilter]=useState('');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [selected,setSelected]=useState(new Set());
  const [expanded,setExpanded]=useState(null);
  const [sortCol,setSortCol]=useState('matched_at');
  const [sortDir,setSortDir]=useState('desc');
  const [batchMsg,setBatchMsg]=useState('');

  const fmtTime=d=>d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});

  const filtered=useMemo(()=>{
    let r=D.ALERTS;
    if(sevFilter.length>0) r=r.filter(a=>sevFilter.includes(a.severity));
    if(statusFilter!=='all') r=r.filter(a=>a.status===statusFilter);
    if(hostFilter) r=r.filter(a=>a.endpoint_id.toLowerCase().includes(hostFilter.toLowerCase()));
    if(search){const sl=search.toLowerCase();r=r.filter(a=>{const sn=a.event_snapshot||{};return a.rule_name.toLowerCase().includes(sl)||(sn.src_ip||sn.client_ip||'').includes(sl)||a.endpoint_id.toLowerCase().includes(sl);});}
    r=[...r].sort((a,b)=>{
      let va=a[sortCol]||'',vb=b[sortCol]||'';
      if(va instanceof Date) va=va.getTime(),vb=vb.getTime();
      return sortDir==='asc'?(va>vb?1:-1):(va<vb?1:-1);
    });
    return r;
  },[sevFilter,statusFilter,hostFilter,search,sortCol,sortDir,D.ALERTS]);

  const pages=Math.ceil(filtered.length/PAGE_SIZE);
  const pageRows=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  const counts=useMemo(()=>({
    critical:D.ALERTS.filter(a=>a.severity==='critical'&&a.status==='open').length,
    high:D.ALERTS.filter(a=>a.severity==='high'&&a.status==='open').length,
    medium:D.ALERTS.filter(a=>a.severity==='medium'&&a.status==='open').length,
    low:D.ALERTS.filter(a=>a.severity==='low'&&a.status==='open').length,
    total:D.ALERTS.filter(a=>a.status==='open').length,
  }),[D.ALERTS]);

  const toggleSev=(s)=>setSevFilter(f=>f.includes(s)?f.filter(x=>x!==s):[...f,s]);
  const toggleAll=()=>setSelected(s=>s.size===pageRows.length?new Set():new Set(pageRows.map(r=>r.id)));
  const toggleRow=id=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});
  const sortBy=(col)=>{setSortCol(col);setSortDir(d=>col===sortCol?(d==='asc'?'desc':'asc'):'desc');};
  const SortIcon=({col})=>sortCol===col?(
    <span style={{color:T.cyan,marginLeft:3,fontSize:8}}>{sortDir==='asc'?'▲':'▼'}</span>
  ):null;

  const doBatch=async(action)=>{
    if(selected.size===0)return;
    const ids=[...selected];
    const ok=await window.VIGIL_API.batchAlerts(ids,action.toLowerCase());
    if(ok){setBatchMsg(`${action} applied to ${ids.length} alerts`);setSelected(new Set());setTimeout(()=>setBatchMsg(''),3000);}
  };

  const snap=a=>a.event_snapshot;

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',padding:14,gap:10}}>

      <div style={{display:'flex',gap:8}}>
        {[['Critical',counts.critical,SC.critical,'critical'],
          ['High',counts.high,SC.high,'high'],
          ['Medium',counts.medium,SC.medium,'medium'],
          ['Low',counts.low,SC.low,'low'],
          ['Total Open',counts.total,T.cyan,null]].map(([l,v,c,s])=>(
          <Card key={l} style={{padding:'10px 14px',flex:1,cursor:s?'pointer':'default',
            border:s&&sevFilter.includes(s)?`1px solid ${c}44`:undefined,
            background:s&&sevFilter.includes(s)?c+'08':undefined}}
            onClick={()=>s&&(toggleSev(s),setPage(0))}>
            <div style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',color:T.txm,marginBottom:4}}>{l}</div>
            <div style={{fontFamily:'JetBrains Mono',fontSize:22,fontWeight:500,color:sevFilter.includes(s)?c:T.tx,transition:'color .15s'}}>{v}</div>
          </Card>
        ))}
      </div>

      <Card style={{padding:'10px 14px'}}>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{position:'relative',flex:'1 1 200px',maxWidth:280}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.txm} strokeWidth="2"
              style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)'}}>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}
              placeholder="Search rule, host, IP…"
              style={{width:'100%',background:T.bg,border:`1px solid ${T.bd}`,borderRadius:7,
                padding:'6px 8px 6px 27px',color:T.tx,fontFamily:'Inter',fontSize:11,outline:'none'}}/>
          </div>
          <div style={{display:'flex',gap:3}}>
            {['open','acknowledged','resolved','all'].map(s=>(
              <Pill key={s} label={s} active={statusFilter===s} onClick={()=>{setStatusFilter(s);setPage(0);}}/>
            ))}
          </div>
          <input value={hostFilter} onChange={e=>{setHostFilter(e.target.value);setPage(0);}}
            placeholder="Filter by host…"
            style={{background:T.bg,border:`1px solid ${T.bd}`,borderRadius:7,
              padding:'5px 10px',color:T.tx,fontFamily:'JetBrains Mono',fontSize:11,outline:'none',width:140}}/>
          {sevFilter.length>0&&(
            <div style={{display:'flex',gap:4,alignItems:'center'}}>
              {sevFilter.map(s=>(
                <span key={s} onClick={()=>toggleSev(s)}
                  style={{fontSize:9,fontFamily:'JetBrains Mono',color:SC[s],
                    background:SC[s]+'14',border:`1px solid ${SC[s]}44`,
                    borderRadius:4,padding:'2px 7px',cursor:'pointer'}}>
                  {s} ×
                </span>
              ))}
            </div>
          )}
          <span style={{marginLeft:'auto',fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',flexShrink:0}}>
            {filtered.length} alerts
          </span>
        </div>
      </Card>

      {(selected.size>0||batchMsg)&&(
        <div className="anim-in" style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',
          background:batchMsg?T.green+'10':T.cyan+'08',
          border:`1px solid ${batchMsg?T.green+'33':T.cyan+'33'}`,borderRadius:8}}>
          {batchMsg?(
            <><div style={{width:6,height:6,borderRadius:'50%',background:T.green,boxShadow:`0 0 6px ${T.green}`}}/>
            <span style={{fontSize:12,fontFamily:'Space Grotesk',fontWeight:500,color:T.green}}>✓ {batchMsg}</span></>
          ):(
            <>
              <span style={{fontSize:11,fontFamily:'JetBrains Mono',color:T.txm}}>{selected.size} selected</span>
              {[['Acknowledge',T.green],['Resolve',T.cyan]].map(([lbl,c])=>(
                <button key={lbl} onClick={()=>doBatch(lbl)}
                  style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:c,
                    background:c+'14',border:`1px solid ${c}44`,borderRadius:6,
                    padding:'4px 12px',cursor:'pointer',transition:'all .12s'}}
                  onMouseEnter={e=>e.currentTarget.style.background=c+'28'}
                  onMouseLeave={e=>e.currentTarget.style.background=c+'14'}>{lbl}</button>
              ))}
              <button onClick={()=>setSelected(new Set())}
                style={{marginLeft:'auto',fontSize:10,color:T.txm,background:'transparent',
                  border:T.cardBorder,borderRadius:5,padding:'3px 8px',cursor:'pointer'}}>Clear</button>
            </>
          )}
        </div>
      )}

      <Card style={{flex:1,overflow:'hidden',padding:0,display:'flex',flexDirection:'column'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead style={{position:'sticky',top:0,background:T.card,zIndex:1}}>
            <tr style={{borderBottom:`1px solid ${T.bd}`}}>
              <th style={{width:36,padding:'6px 10px'}}>
                <input type="checkbox" checked={selected.size===pageRows.length&&pageRows.length>0}
                  onChange={toggleAll} style={{cursor:'pointer',accentColor:T.cyan}}/>
              </th>
              {[['matched_at','Time',80],['rule_name','Rule',null],['severity','Severity',90],
                ['endpoint_id','Host',110],['','Src IP',120],['status','Status',90],['','',80]].map(([col,h,w])=>(
                <th key={h} onClick={col?()=>sortBy(col):undefined}
                  style={{textAlign:'left',padding:'6px 10px',fontSize:9,fontFamily:'Space Grotesk',
                    fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:T.txm,
                    cursor:col?'pointer':'default',whiteSpace:'nowrap',width:w||undefined,
                    userSelect:'none'}}>
                  {h}<SortIcon col={col}/>
                </th>
              ))}
            </tr>
          </thead>
        </table>
        <div style={{flex:1,overflowY:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <tbody>
              {pageRows.length===0&&(
                <tr><td colSpan={8} style={{padding:'40px',textAlign:'center',color:T.txm,fontSize:12}}>
                  No alerts match the current filters
                </td></tr>
              )}
              {pageRows.map(a=>{
                const isExp=expanded===a.id;
                const isSel=selected.has(a.id);
                return(
                  <React.Fragment key={a.id}>
                    <tr onClick={e=>{if(e.target.type==='checkbox')return;setExpanded(isExp?null:a.id);}}
                      style={{borderBottom:isExp?'none':`1px solid ${T.bd}`,cursor:'pointer',
                        transition:'background .1s',
                        background:isSel?T.cyan+'08':isExp?T.el:'transparent'}}
                      onMouseEnter={e=>{if(!isExp)e.currentTarget.style.background=T.el;}}
                      onMouseLeave={e=>{if(!isExp)e.currentTarget.style.background=isSel?T.cyan+'08':'transparent';}}>
                      <td style={{width:36,padding:'7px 10px'}} onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={()=>toggleRow(a.id)}
                          style={{cursor:'pointer',accentColor:T.cyan}}/>
                      </td>
                      <td style={{padding:'7px 10px',fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,whiteSpace:'nowrap'}}>
                        {fmtTime(a.matched_at)}</td>
                      <td style={{padding:'7px 10px',maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                        onClick={e=>{e.stopPropagation();onInvestigate&&onInvestigate(a);}}>
                        <span style={{color:T.tx,cursor:'pointer',borderBottom:`1px solid ${T.bd}`,transition:'all .12s'}}
                          onMouseEnter={e=>{e.currentTarget.style.color=T.cyan;e.currentTarget.style.borderColor=T.cyan;}}
                          onMouseLeave={e=>{e.currentTarget.style.color=T.tx;e.currentTarget.style.borderColor=T.bd;}}>
                          {a.rule_name}
                        </span>
                      </td>
                      <td style={{padding:'7px 10px'}}><SevBadge sev={a.severity}/></td>
                      <td style={{padding:'7px 10px',fontFamily:'JetBrains Mono',fontSize:10,color:T.txm}}>{a.endpoint_id}</td>
                      <td style={{padding:'7px 10px',fontFamily:'JetBrains Mono',fontSize:10,color:T.txm}}>{snap(a).src_ip||snap(a).client_ip||'—'}</td>
                      <td style={{padding:'7px 10px'}}>
                        <span style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,
                          color:a.status==='open'?T.amber:a.status==='resolved'?T.green:T.txm,
                          textTransform:'capitalize'}}>{a.status}</span>
                      </td>
                      <td style={{padding:'7px 10px',textAlign:'right'}}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isExp?T.cyan:T.txm}
                          strokeWidth="2" strokeLinecap="round"
                          style={{transform:isExp?'rotate(180deg)':'none',transition:'transform .2s'}}>
                          <path d="m6 9 6 6 6-6"/>
                        </svg>
                      </td>
                    </tr>
                    {isExp&&(
                      <tr>
                        <td colSpan={8} style={{padding:0,borderBottom:`1px solid ${T.bd}`}}>
                          <div className="anim-in" style={{padding:'12px 14px 14px 56px',background:T.el,
                            borderLeft:`3px solid ${SC[a.severity]}`}}>
                            <div style={{display:'flex',gap:16,alignItems:'flex-start'}}>
                              <div style={{flex:1,display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px 16px'}}>
                                {(()=>{const _p=window.pickSnap(snap(a));return _p.isWeb
                                  ?[['Client IP',_p.srcIp||'—'],['Method',snap(a).method||'—'],['Status',snap(a).status_code!=null?String(snap(a).status_code):'—'],['Host',snap(a).host||'—'],['Path',snap(a).path||'—'],['UA Type',snap(a).ua_category||'—']]
                                  :[['User',_p.user||'—'],['Process',_p.process||'—'],['Dst IP',_p.dstIp||'internal'],['PID',_p.pid||'—'],['MITRE',_p.tactic||'—'],['Rule ID',a.rule_id]];
                                })().map(([k,v])=>(
                                  <div key={k}>
                                    <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                                      textTransform:'uppercase',letterSpacing:'.08em'}}>{k}</div>
                                    <div style={{fontSize:11,color:T.tx,fontFamily:'JetBrains Mono',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{String(v)}</div>
                                  </div>
                                ))}
                              </div>
                              <div style={{width:260,flexShrink:0}}>
                                <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                                  textTransform:'uppercase',letterSpacing:'.08em',marginBottom:4}}>{window.pickSnap(snap(a)).isWeb?'Request':'Command'}</div>
                                <div style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
                                  background:T.bg,border:`1px solid ${T.bd}`,borderRadius:6,padding:'5px 8px',
                                  overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:10}}
                                  title={window.pickSnap(snap(a)).cmdline}>{window.pickSnap(snap(a)).cmdline||'—'}</div>
                                <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                                  <button onClick={async()=>{await window.VIGIL_API.acknowledgeAlert(a.id,'');setExpanded(null);}}
                                    style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,
                                      color:T.green,background:T.green+'12',border:`1px solid ${T.green}33`,
                                      borderRadius:6,padding:'4px 9px',cursor:'pointer'}}>Acknowledge</button>
                                  <button onClick={()=>{setExpanded(null);onInvestigate&&onInvestigate(a);}}
                                    style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,
                                      background:T.cyan+'14',border:`1px solid ${T.cyan}44`,
                                      borderRadius:6,padding:'4px 12px',cursor:'pointer',marginLeft:'auto'}}>
                                    Investigate →
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {pages>1&&(
          <div style={{padding:'8px 14px',borderTop:`1px solid ${T.bd}`,display:'flex',
            alignItems:'center',gap:6,background:T.card,flexShrink:0}}>
            <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',flex:1}}>
              Showing {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,filtered.length)} of {filtered.length}
            </span>
            <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
              style={{fontSize:10,fontFamily:'Space Grotesk',color:page===0?T.bd:T.txm,
                background:'transparent',border:T.cardBorder,borderRadius:5,
                padding:'3px 10px',cursor:page===0?'not-allowed':'pointer'}}>← Prev</button>
            {Array.from({length:Math.min(pages,7)},(_,i)=>{
              const p=pages<=7?i:page<4?i:page>pages-4?pages-7+i:page-3+i;
              return(
                <button key={p} onClick={()=>setPage(p)}
                  style={{fontSize:10,fontFamily:'JetBrains Mono',
                    color:p===page?T.cyan:T.txm,
                    background:p===page?T.cyan+'14':'transparent',
                    border:`1px solid ${p===page?T.cyan+'44':T.bd}`,
                    borderRadius:5,padding:'3px 8px',cursor:'pointer',minWidth:28}}>{p+1}</button>
              );
            })}
            <button onClick={()=>setPage(p=>Math.min(pages-1,p+1))} disabled={page===pages-1}
              style={{fontSize:10,fontFamily:'Space Grotesk',color:page===pages-1?T.bd:T.txm,
                background:'transparent',border:T.cardBorder,borderRadius:5,
                padding:'3px 10px',cursor:page===pages-1?'not-allowed':'pointer'}}>Next →</button>
          </div>
        )}
      </Card>
    </div>
  );
}

window.AlertsView = AlertsView;
})();
