// ── Detection Rules View ────────────────────────────────────────────────────
(function(){
const {useState} = React;
const D = window.VIGIL_DATA;

const MITRE_TACTICS=[
  {id:'TA0001',name:'Initial Access',short:'Init Access'},
  {id:'TA0002',name:'Execution',short:'Execution'},
  {id:'TA0003',name:'Persistence',short:'Persistence'},
  {id:'TA0004',name:'Privilege Escalation',short:'PrivEsc'},
  {id:'TA0005',name:'Defense Evasion',short:'Def Evasion'},
  {id:'TA0006',name:'Credential Access',short:'Cred Access'},
  {id:'TA0007',name:'Discovery',short:'Discovery'},
  {id:'TA0008',name:'Lateral Movement',short:'Lateral Mvmt'},
  {id:'TA0009',name:'Collection',short:'Collection'},
  {id:'TA0010',name:'Exfiltration',short:'Exfiltration'},
  {id:'TA0011',name:'Command & Control',short:'C2'},
  {id:'TA0040',name:'Impact',short:'Impact'},
];

function RulesView(){
  const T=useT();const SC=useSev();
  const [selected,setSelected]=useState(null);
  const [tacticFilter,setTacticFilter]=useState(null);
  const [sevFilter,setSevFilter]=useState(null);
  const [search,setSearch]=useState('');
  const [showSigma,setShowSigma]=useState(false);

  const rules=D.RULES;

  const toggle=async(id)=>{
    const rule=rules.find(r=>r.id===id);
    if(!rule)return;
    await window.VIGIL_API.toggleRule(id,!rule.enabled);
    if(selected?.id===id) setSelected(s=>s?{...s,enabled:!s.enabled}:null);
  };

  const tacticCounts={};
  rules.forEach(r=>{if(r.enabled)(tacticCounts[r.mitre_tactic]=(tacticCounts[r.mitre_tactic]||0)+1);});
  const maxCount=Math.max(...Object.values(tacticCounts),1);

  const filtered=rules.filter(r=>{
    if(tacticFilter&&r.mitre_tactic!==tacticFilter)return false;
    if(sevFilter&&r.severity!==sevFilter)return false;
    if(search&&!r.name.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });

  const stats={total:rules.length,enabled:rules.filter(r=>r.enabled).length,
    critical:rules.filter(r=>r.severity==='critical').length,
    high:rules.filter(r=>r.severity==='high').length};
  const totalHits=rules.reduce((s,r)=>s+(r.hits||0),0);

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',padding:14,gap:10}}>

      <div style={{display:'flex',gap:8}}>
        {[['Total Rules',stats.total,T.cyan],['Active',stats.enabled,T.green],
          ['Critical',stats.critical,SC.critical],['High Severity',stats.high,SC.high],
          ['Total Hits (7d)',totalHits.toLocaleString(),T.amber]].map(([l,v,c])=>(
          <Card key={l} style={{padding:'12px 16px',flex:1}}>
            <div style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'.09em',color:T.txm,marginBottom:4}}>{l}</div>
            <div style={{fontFamily:'JetBrains Mono',fontSize:22,fontWeight:500,color:c}}>{v}</div>
          </Card>
        ))}
      </div>

      <Card style={{padding:16}}>
        <SectionHead title="MITRE ATT&CK Coverage"
          right={<span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{Object.keys(tacticCounts).length}/{MITRE_TACTICS.length} tactics covered</span>}/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(12,1fr)',gap:6}}>
          {MITRE_TACTICS.map(tac=>{
            const count=tacticCounts[tac.id]||0;
            const pct=count/maxCount;
            const isActive=tacticFilter===tac.id;
            const hasCoverage=count>0;
            const bg=hasCoverage
              ?`rgba(0,229,255,${0.08+pct*0.28})`
              :T.el;
            const border=isActive?`1px solid ${T.cyan}88`:hasCoverage?`1px solid ${T.cyan}22`:T.cardBorder;
            return(
              <div key={tac.id} onClick={()=>setTacticFilter(isActive?null:tac.id)}
                style={{borderRadius:8,padding:'8px 6px',textAlign:'center',cursor:'pointer',
                  background:bg,border,transition:'all .15s',
                  boxShadow:isActive?`0 0 12px ${T.cyan}22`:''}}
                onMouseEnter={e=>e.currentTarget.style.background=hasCoverage?`rgba(0,229,255,${0.15+pct*0.28})`:T.bd}
                onMouseLeave={e=>e.currentTarget.style.background=bg}>
                <div style={{fontFamily:'JetBrains Mono',fontSize:16,fontWeight:500,
                  color:hasCoverage?T.cyan:T.txm,lineHeight:1,marginBottom:3}}>
                  {hasCoverage?count:'—'}
                </div>
                <div style={{fontSize:8,color:hasCoverage?T.tx:T.txm,fontFamily:'Space Grotesk',
                  fontWeight:hasCoverage?600:400,lineHeight:1.2}}>
                  {tac.short}
                </div>
                <div style={{fontSize:7,color:T.txm,fontFamily:'JetBrains Mono',marginTop:2}}>{tac.id}</div>
              </div>
            );
          })}
        </div>
        {tacticFilter&&(
          <div style={{marginTop:10,display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:11,color:T.txm}}>Filtering by tactic:</span>
            <span style={{fontSize:11,color:T.cyan,fontFamily:'JetBrains Mono',fontWeight:500}}>
              {MITRE_TACTICS.find(t=>t.id===tacticFilter)?.name} ({tacticFilter})</span>
            <button onClick={()=>setTacticFilter(null)}
              style={{fontSize:10,color:T.txm,background:'transparent',border:T.cardBorder,
                borderRadius:4,padding:'2px 8px',cursor:'pointer'}}>✕ Clear</button>
          </div>
        )}
      </Card>

      <div style={{display:'flex',gap:10,flex:1,minHeight:0}}>
        <Card style={{flex:1,overflow:'hidden',padding:0,display:'flex',flexDirection:'column'}}>
          <div style={{padding:'10px 16px',borderBottom:T.cardBorder,display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
            <div style={{position:'relative',flex:1,maxWidth:260}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.txm} strokeWidth="2"
                style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)'}}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                placeholder="Search rules…"
                style={{width:'100%',background:T.bg,border:T.cardBorder,borderRadius:6,
                  padding:'5px 8px 5px 26px',color:T.tx,fontFamily:'Inter',fontSize:11,outline:'none'}}/>
            </div>
            <div style={{display:'flex',gap:4}}>
              {['critical','high','medium','low'].map(s=>(
                <Pill key={s} label={s} active={sevFilter===s} onClick={()=>setSevFilter(sevFilter===s?null:s)} color={SC[s]}/>
              ))}
            </div>
            <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono',marginLeft:'auto'}}>{filtered.length} rules</span>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead style={{position:'sticky',top:0,background:T.card,zIndex:1}}>
                <tr style={{borderBottom:T.cardBorder}}>
                  {['','Rule','Severity','Tactic','Hits','Status',''].map((h,i)=>(
                    <th key={i} style={{textAlign:'left',padding:'6px 12px',fontSize:9,fontFamily:'Space Grotesk',
                      fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:T.txm}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length===0&&(
                  <tr><td colSpan={7} style={{padding:'30px',textAlign:'center',color:T.txm,fontSize:11}}>No rules match filters</td></tr>
                )}
                {filtered.map(r=>(
                  <tr key={r.id}
                    style={{borderBottom:T.cardBorder,cursor:'pointer',
                      background:selected?.id===r.id?T.el:'transparent',opacity:r.enabled?1:0.5,transition:'all .12s'}}
                    onClick={()=>{setSelected(r);setShowSigma(false);}}
                    onMouseEnter={e=>e.currentTarget.style.background=T.el}
                    onMouseLeave={e=>e.currentTarget.style.background=selected?.id===r.id?T.el:'transparent'}>
                    <td style={{padding:'8px 12px',width:28}}>
                      <div style={{width:7,height:7,borderRadius:'50%',
                        background:r.enabled?T.green:T.txm,
                        boxShadow:r.enabled?`0 0 5px ${T.green}`:'none'}}/>
                    </td>
                    <td style={{padding:'8px 12px',color:T.tx,fontSize:12,maxWidth:240,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</td>
                    <td style={{padding:'8px 12px'}}><SevBadge sev={r.severity}/></td>
                    <td style={{padding:'8px 12px'}}>
                      <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
                        background:T.cyan+'10',border:`1px solid ${T.cyan}22`,
                        borderRadius:4,padding:'2px 6px'}}>{r.mitre_tactic}</span>
                    </td>
                    <td style={{padding:'8px 12px',fontFamily:'JetBrains Mono',fontSize:11,
                      color:r.hits>0?T.amber:T.txm,fontWeight:r.hits>0?500:400}}>{r.hits||0}</td>
                    <td style={{padding:'8px 12px'}}>
                      <span style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,
                        color:r.enabled?T.green:T.txm}}>{r.enabled?'Active':'Disabled'}</span>
                    </td>
                    <td style={{padding:'8px 12px'}}>
                      <button onClick={e=>{e.stopPropagation();toggle(r.id);}}
                        style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,
                          color:r.enabled?T.red:T.green,background:'transparent',
                          border:T.cardBorder,borderRadius:5,padding:'3px 8px',cursor:'pointer'}}>
                        {r.enabled?'Disable':'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {selected&&(
          <Card style={{width:340,flexShrink:0,overflow:'hidden',padding:0,display:'flex',flexDirection:'column'}}>
            <div style={{padding:'14px 16px',borderBottom:T.cardBorder,flexShrink:0}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{flex:1,minWidth:0,marginRight:8}}>
                  <SevBadge sev={selected.severity} size="sm"/>
                  <div style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,
                    color:T.tx,marginTop:6,lineHeight:1.3}}>{selected.name}</div>
                </div>
                <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',
                  cursor:'pointer',color:T.txm,fontSize:18,lineHeight:1,flexShrink:0}}>×</button>
              </div>
              <p style={{fontSize:11,color:T.txm,marginTop:8,lineHeight:1.5}}>{selected.description}</p>
            </div>

            <div style={{padding:'12px 16px',borderBottom:T.cardBorder,flexShrink:0}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 16px'}}>
                {[['MITRE Tactic',selected.mitre_tactic],['Status',selected.enabled?'Active':'Disabled'],
                  ['Hits (7d)',selected.hits||0],['Rule ID',selected.id],
                  ['Created',selected.created_at instanceof Date?selected.created_at.toLocaleDateString():new Date(selected.created_at).toLocaleDateString()],
                  ['Updated',selected.updated_at instanceof Date?selected.updated_at.toLocaleDateString():new Date(selected.updated_at).toLocaleDateString()]].map(([k,v])=>(
                  <div key={k}>
                    <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                      textTransform:'uppercase',letterSpacing:'.07em'}}>{k}</div>
                    <div style={{fontSize:11,color:k==='Status'?(selected.enabled?T.green:T.txm):T.tx,
                      fontFamily:'JetBrains Mono',marginTop:2}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{flex:1,overflowY:'auto',padding:'12px 16px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                  textTransform:'uppercase',letterSpacing:'.09em'}}>Sigma YAML</span>
                <button onClick={()=>setShowSigma(s=>!s)} style={{fontSize:10,fontFamily:'Space Grotesk',
                  color:T.cyan,background:T.cyan+'14',border:`1px solid ${T.cyan}33`,
                  borderRadius:5,padding:'2px 8px',cursor:'pointer'}}>
                  {showSigma?'Hide':'Show'}
                </button>
              </div>
              {showSigma&&selected.sigma_yaml&&(
                <pre style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
                  background:T.bg,border:T.cardBorder,borderRadius:8,padding:12,
                  overflow:'auto',lineHeight:1.65,margin:0,whiteSpace:'pre-wrap'}}>
{selected.sigma_yaml}
                </pre>
              )}
              {showSigma&&!selected.sigma_yaml&&(
                <p style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>No YAML available for this rule.</p>
              )}
              <div style={{marginTop:12,display:'flex',gap:6}}>
                <button onClick={()=>toggle(selected.id)}
                  style={{flex:1,fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,
                    color:selected.enabled?T.red:T.green,
                    background:(selected.enabled?T.red:T.green)+'14',
                    border:`1px solid ${(selected.enabled?T.red:T.green)}33`,
                    borderRadius:7,padding:'8px',cursor:'pointer'}}>
                  {selected.enabled?'Disable Rule':'Enable Rule'}
                </button>
                <button style={{flex:1,fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,
                  color:T.cyan,background:T.cyan+'14',border:`1px solid ${T.cyan}33`,
                  borderRadius:7,padding:'8px',cursor:'pointer'}}>Edit in CLI →</button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

window.RulesView = RulesView;
})();
