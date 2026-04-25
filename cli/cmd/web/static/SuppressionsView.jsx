// ── Suppressions Manager ─────────────────────────────────────────────────────
(function(){
const {useState,useMemo} = React;
const D = window.VIGIL_DATA;

const FIELD_SUGGESTIONS=['rule_name','client_ip','path','user_agent','event_data.IpAddress','event_data.TargetUserName','event_data.NewProcessName','_HOSTNAME','_COMM'];

function SuppressionsView(){
  const T=useT();
  const [search,setSearch]=useState('');
  const [statusFilter,setStatusFilter]=useState('all');
  const [sortBy,setSortBy]=useState('hit_count');
  const [showCreate,setShowCreate]=useState(false);
  const [deleteConfirm,setDeleteConfirm]=useState(null);
  const [form,setForm]=useState({name:'',description:'',field_path:'',field_value:'',match_type:'exact',scope:'global'});
  const [formSaved,setFormSaved]=useState(false);
  const [error,setError]=useState(null);
  const showError=(msg)=>{setError(msg);setTimeout(()=>setError(null),6000);};

  const sups=D.SUPPRESSIONS;

  const fmtAge=d=>{if(!d)return'—';const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;};
  const fmtDate=d=>new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});

  const toggle=async(id)=>{
    const s=sups.find(x=>x.id===id);
    if(!s)return;
    const ok=await window.VIGIL_API.toggleSuppression(id,!s.enabled);
    if(!ok)showError(`Failed to ${s.enabled?'disable':'enable'} suppression. Check API connectivity.`);
  };

  const del=async(id)=>{
    setDeleteConfirm(null);
    const ok=await window.VIGIL_API.deleteSuppression(id);
    if(!ok)showError('Failed to delete suppression. Check API connectivity.');
  };

  const setF=(k,v)=>setForm(f=>({...f,[k]:v}));

  const filtered=useMemo(()=>{
    let r=sups;
    if(statusFilter==='enabled') r=r.filter(s=>s.enabled);
    if(statusFilter==='disabled') r=r.filter(s=>!s.enabled);
    if(search) r=r.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||
      s.field_path.toLowerCase().includes(search.toLowerCase())||
      s.field_value.toLowerCase().includes(search.toLowerCase()));
    r=[...r].sort((a,b)=>sortBy==='hit_count'?(b.hit_count||0)-(a.hit_count||0):
      sortBy==='created'?new Date(b.created_at)-new Date(a.created_at):
      a.name.localeCompare(b.name));
    return r;
  },[sups,statusFilter,search,sortBy]);

  const maxHits=Math.max(...sups.map(s=>s.hit_count||0),1);
  const totalSuppressed=sups.filter(s=>s.enabled).reduce((sum,s)=>sum+(s.hit_count||0),0);
  const activeSups=sups.filter(s=>s.enabled).length;

  const createSup=async()=>{
    if(!form.name||!form.field_path||!form.field_value)return;
    const result=await window.VIGIL_API.createSuppression({
      name:form.name,description:form.description||'',
      field_path:form.field_path,field_value:form.field_value,
      match_type:form.match_type,scope:form.scope
    });
    if(result){
      setForm({name:'',description:'',field_path:'',field_value:'',match_type:'exact',scope:'global'});
      setFormSaved(true);setShowCreate(false);setTimeout(()=>setFormSaved(false),3000);
    } else {
      showError('Failed to create suppression. Check that the API is reachable and you have a valid API key.');
    }
  };

  return(
    <div style={{flex:1,display:'flex',overflow:'hidden'}}>
      <div style={{flex:1,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10}}>

        <div style={{display:'flex',gap:8}}>
          {[[totalSuppressed.toLocaleString(),'Events Suppressed',T.cyan,'total hit count'],
            [activeSups,'Active Rules',T.green,'currently suppressing'],
            [sups.filter(s=>!s.enabled).length,'Disabled',T.txm,'paused rules'],
            [sups.filter(s=>(s.hit_count||0)===0).length,'Zero hits',T.amber,'never matched']].map(([v,l,c,sub])=>(
            <Card key={l} style={{padding:'12px 16px',flex:1}}>
              <div style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',color:T.txm,marginBottom:4}}>{l}</div>
              <div style={{fontFamily:'JetBrains Mono',fontSize:22,fontWeight:500,color:c}}>{v}</div>
              <div style={{fontSize:10,color:T.txm,marginTop:2}}>{sub}</div>
            </Card>
          ))}
          <button onClick={()=>setShowCreate(true)}
            style={{padding:'0 20px',background:T.cyan,border:'none',borderRadius:12,cursor:'pointer',
              fontFamily:'Space Grotesk',fontWeight:700,fontSize:12,color:'#080B10',
              boxShadow:`0 0 20px ${T.cyan}33`,transition:'all .15s',whiteSpace:'nowrap',flexShrink:0}}
            onMouseEnter={e=>{e.currentTarget.style.opacity='.85';e.currentTarget.style.transform='translateY(-1px)';}}
            onMouseLeave={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.transform='none';}}>
            + New Suppression
          </button>
        </div>

        {error&&(
          <div className="anim-in" style={{padding:'10px 14px',background:T.red+'10',
            border:`1px solid ${T.red}33`,borderRadius:8,display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:T.red,flexShrink:0}}/>
            <span style={{fontSize:12,fontFamily:'Space Grotesk',fontWeight:500,color:T.red,flex:1}}>{error}</span>
            <button onClick={()=>setError(null)} style={{background:'none',border:'none',color:T.red,cursor:'pointer',fontSize:16,padding:0}}>×</button>
          </div>
        )}

        {formSaved&&(
          <div className="anim-in" style={{padding:'10px 14px',background:T.green+'10',
            border:`1px solid ${T.green}33`,borderRadius:8,display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:T.green,boxShadow:`0 0 6px ${T.green}`}}/>
            <span style={{fontSize:12,fontFamily:'Space Grotesk',fontWeight:500,color:T.green}}>Suppression rule created and active</span>
          </div>
        )}

        <Card style={{padding:'10px 14px'}}>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <div style={{position:'relative',flex:1,maxWidth:260}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.txm} strokeWidth="2"
                style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)'}}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search suppressions…"
                style={{width:'100%',background:T.bg,border:`1px solid ${T.bd}`,borderRadius:7,
                  padding:'6px 8px 6px 27px',color:T.tx,fontFamily:'Inter',fontSize:11,outline:'none'}}/>
            </div>
            <div style={{display:'flex',gap:3}}>
              {['all','enabled','disabled'].map(f=>(
                <Pill key={f} label={f} active={statusFilter===f} onClick={()=>setStatusFilter(f)}/>
              ))}
            </div>
            <div style={{display:'flex',gap:3,marginLeft:'auto'}}>
              <span style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',alignSelf:'center',marginRight:4}}>Sort:</span>
              {[['hit_count','Hit Count'],['created','Created'],['name','Name']].map(([k,l])=>(
                <Pill key={k} label={l} active={sortBy===k} onClick={()=>setSortBy(k)}/>
              ))}
            </div>
            <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{filtered.length} rules</span>
          </div>
        </Card>

        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {filtered.map((s)=>(
            <Card key={s.id} style={{padding:14,opacity:s.enabled?1:.65,transition:'all .2s',
              border:s.enabled?undefined:`1px dashed ${T.bd}`}}>
              <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
                <div onClick={()=>toggle(s.id)}
                  style={{width:36,height:20,borderRadius:10,marginTop:2,flexShrink:0,
                    background:s.enabled?T.green+'44':T.bd,
                    border:`1px solid ${s.enabled?T.green+'66':T.bd}`,
                    position:'relative',cursor:'pointer',transition:'all .2s'}}>
                  <div style={{position:'absolute',top:3,left:s.enabled?17:3,width:12,height:12,
                    borderRadius:'50%',background:s.enabled?T.green:T.txm,
                    transition:'left .2s',boxShadow:s.enabled?`0 0 5px ${T.green}`:'none'}}/>
                </div>

                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                    <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,color:T.tx}}>{s.name}</span>
                    <span style={{fontSize:9,fontFamily:'JetBrains Mono',color:T.cyan,
                      background:T.cyan+'10',border:`1px solid ${T.cyan}22`,borderRadius:4,padding:'2px 6px'}}>{s.match_type}</span>
                    <span style={{fontSize:9,fontFamily:'JetBrains Mono',color:T.purple,
                      background:T.purple+'10',border:`1px solid ${T.purple}22`,borderRadius:4,padding:'2px 6px'}}>
                      {s.scope==='global'?'global':s.scope}</span>
                    {!s.enabled&&<span style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:600,color:T.txm,
                      background:T.bd,borderRadius:4,padding:'2px 6px'}}>DISABLED</span>}
                  </div>
                  {s.description&&<p style={{fontSize:11,color:T.txm,margin:'0 0 8px',lineHeight:1.5}}>{s.description}</p>}

                  <div style={{fontFamily:'JetBrains Mono',fontSize:11,
                    background:T.bg,border:`1px solid ${T.bd}`,borderRadius:6,
                    padding:'5px 10px',marginBottom:8,display:'inline-flex',gap:6,alignItems:'center'}}>
                    <span style={{color:T.txm}}>{s.field_path}</span>
                    <span style={{color:T.bd}}>→</span>
                    <span style={{color:T.cyan,fontWeight:500}}>{s.field_value}</span>
                  </div>

                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{flex:1,height:4,background:T.bd,borderRadius:2,overflow:'hidden'}}>
                      <div style={{width:`${((s.hit_count||0)/maxHits)*100}%`,height:'100%',
                        background:(s.hit_count||0)>500?T.green:(s.hit_count||0)>100?T.cyan:T.txm,
                        borderRadius:2,transition:'width .8s ease'}}/>
                    </div>
                    <span style={{fontSize:11,fontFamily:'JetBrains Mono',fontWeight:500,
                      color:(s.hit_count||0)>500?T.green:(s.hit_count||0)>100?T.cyan:T.txm,
                      minWidth:60,textAlign:'right'}}>{(s.hit_count||0).toLocaleString()} hits</span>
                  </div>
                </div>

                <div style={{flexShrink:0,textAlign:'right',display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
                  <div style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono'}}>Created {fmtDate(s.created_at)}</div>
                  <div style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono'}}>Last hit {fmtAge(s.last_hit_at)}</div>
                  <div style={{display:'flex',gap:5,marginTop:4}}>
                    <button onClick={()=>toggle(s.id)}
                      style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:500,
                        color:s.enabled?T.amber:T.green,background:'transparent',
                        border:`1px solid ${s.enabled?T.amber+'44':T.green+'44'}`,
                        borderRadius:5,padding:'3px 8px',cursor:'pointer',transition:'all .12s'}}>
                      {s.enabled?'Disable':'Enable'}
                    </button>
                    {deleteConfirm===s.id?(
                      <div style={{display:'flex',gap:4}}>
                        <button onClick={()=>del(s.id)}
                          style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:600,
                            color:T.red,background:T.red+'14',border:`1px solid ${T.red}44`,
                            borderRadius:5,padding:'3px 8px',cursor:'pointer'}}>Confirm</button>
                        <button onClick={()=>setDeleteConfirm(null)}
                          style={{fontSize:9,color:T.txm,background:'transparent',border:`1px solid ${T.bd}`,
                            borderRadius:5,padding:'3px 8px',cursor:'pointer'}}>Cancel</button>
                      </div>
                    ):(
                      <button onClick={()=>setDeleteConfirm(s.id)}
                        style={{fontSize:9,color:T.txm,background:'transparent',
                          border:`1px solid ${T.bd}`,borderRadius:5,padding:'3px 8px',cursor:'pointer',transition:'all .12s'}}
                        onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red+'44';}}
                        onMouseLeave={e=>{e.currentTarget.style.color=T.txm;e.currentTarget.style.borderColor='';}}
                      >Delete</button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length===0&&(
            <div style={{textAlign:'center',padding:'40px 20px',color:T.txm}}>
              <div style={{fontSize:13,fontFamily:'Space Grotesk',color:T.txm,marginBottom:12}}>No suppressions match</div>
              <button onClick={()=>setShowCreate(true)}
                style={{fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,
                  background:T.cyan+'14',border:`1px solid ${T.cyan}33`,borderRadius:7,
                  padding:'7px 16px',cursor:'pointer'}}>Create first suppression →</button>
            </div>
          )}
        </div>
      </div>

      {showCreate&&(
        <div style={{position:'fixed',inset:0,zIndex:500,display:'flex',justifyContent:'flex-end'}}
          onClick={e=>{if(e.target===e.currentTarget)setShowCreate(false);}}>
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.4)'}} onClick={()=>setShowCreate(false)}/>
          <div style={{position:'relative',width:420,background:T.card,borderLeft:`1px solid ${T.bd}`,
            height:'100vh',overflowY:'auto',animation:'drawerIn .2s ease',
            boxShadow:'-8px 0 40px rgba(0,0,0,.3)'}}>
            <div style={{padding:'18px 20px',borderBottom:`1px solid ${T.bd}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:'Space Grotesk',fontWeight:700,fontSize:15,color:T.tx}}>New Suppression</span>
                <button onClick={()=>setShowCreate(false)} style={{background:'none',border:'none',cursor:'pointer',color:T.txm,fontSize:20}}>×</button>
              </div>
              <p style={{fontSize:11,color:T.txm,marginTop:6,lineHeight:1.5}}>
                Suppress events matching a specific field pattern. Active suppressions prevent matching alerts from being created.
              </p>
            </div>
            <div style={{padding:20,display:'flex',flexDirection:'column',gap:14}}>
              {[['Name','name','text','Suppress sudo from svc-deploy'],
                ['Description (optional)','description','text','Normal behavior, known false positive'],
              ].map(([lbl,key,type,ph])=>(
                <div key={key}>
                  <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                    textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>{lbl}</div>
                  <input value={form[key]} onChange={e=>setF(key,e.target.value)} placeholder={ph}
                    style={{width:'100%',background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,
                      padding:'8px 10px',color:T.tx,fontFamily:'Inter',fontSize:12,outline:'none',
                      transition:'border-color .15s'}}
                    onFocus={e=>e.target.style.borderColor=T.cyan}
                    onBlur={e=>e.target.style.borderColor=T.bd}/>
                </div>
              ))}

              <div>
                <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                  textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>Field Path</div>
                <input value={form.field_path} onChange={e=>setF('field_path',e.target.value)}
                  placeholder="event.src_ip"
                  style={{width:'100%',background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,
                    padding:'8px 10px',color:T.tx,fontFamily:'JetBrains Mono',fontSize:12,outline:'none',
                    marginBottom:6,transition:'border-color .15s'}}
                  onFocus={e=>e.target.style.borderColor=T.cyan}
                  onBlur={e=>e.target.style.borderColor=T.bd}/>
                <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                  {FIELD_SUGGESTIONS.map(f=>(
                    <button key={f} onClick={()=>setF('field_path',f)}
                      style={{fontSize:9,fontFamily:'JetBrains Mono',color:form.field_path===f?T.cyan:T.txm,
                        background:form.field_path===f?T.cyan+'14':T.el,
                        border:`1px solid ${form.field_path===f?T.cyan+'44':T.bd}`,
                        borderRadius:4,padding:'2px 7px',cursor:'pointer',transition:'all .12s'}}>{f}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                  textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>Field Value</div>
                <input value={form.field_value} onChange={e=>setF('field_value',e.target.value)}
                  placeholder="10.0.0.1 or svc-deploy or powershell"
                  style={{width:'100%',background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,
                    padding:'8px 10px',color:T.tx,fontFamily:'JetBrains Mono',fontSize:12,outline:'none',
                    transition:'border-color .15s'}}
                  onFocus={e=>e.target.style.borderColor=T.cyan}
                  onBlur={e=>e.target.style.borderColor=T.bd}/>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                {[['Match Type','match_type',['exact','contains','regex']],
                  ['Scope','scope',['global']]].map(([lbl,key,opts])=>(
                  <div key={key}>
                    <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                      textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>{lbl}</div>
                    <select value={form[key]} onChange={e=>setF(key,e.target.value)}
                      style={{width:'100%',background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,
                        padding:'7px 8px',color:T.tx,fontFamily:'JetBrains Mono',fontSize:11,outline:'none',cursor:'pointer'}}>
                      {opts.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              {form.field_path&&form.field_value&&(
                <div className="anim-in" style={{background:T.bg,border:`1px solid ${T.cyan}22`,
                  borderRadius:8,padding:12}}>
                  <div style={{fontSize:9,color:T.cyan,fontFamily:'Space Grotesk',fontWeight:700,
                    textTransform:'uppercase',letterSpacing:'.09em',marginBottom:6}}>Preview</div>
                  <p style={{fontSize:11,color:T.txm,lineHeight:1.6,margin:0,fontFamily:'JetBrains Mono'}}>
                    Suppress events where <span style={{color:T.cyan}}>{form.field_path}</span> {form.match_type} <span style={{color:T.tx}}>{form.field_value}</span> on <span style={{color:T.purple}}>{form.scope}</span>
                  </p>
                </div>
              )}

              <button onClick={createSup}
                disabled={!form.name||!form.field_path||!form.field_value}
                style={{width:'100%',padding:'11px',fontFamily:'Space Grotesk',fontWeight:700,
                  fontSize:13,color:'#080B10',background:T.cyan,border:'none',borderRadius:9,
                  cursor:(!form.name||!form.field_path||!form.field_value)?'not-allowed':'pointer',
                  opacity:(!form.name||!form.field_path||!form.field_value)?.4:1,
                  boxShadow:`0 0 20px ${T.cyan}33`,transition:'all .15s'}}
                onMouseEnter={e=>{if(form.name&&form.field_path&&form.field_value){e.currentTarget.style.opacity='.85';e.currentTarget.style.transform='translateY(-1px)';}}}
                onMouseLeave={e=>{e.currentTarget.style.opacity=(!form.name||!form.field_path||!form.field_value)?'.4':'1';e.currentTarget.style.transform='none';}}>
                Create Suppression Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.SuppressionsView = SuppressionsView;
})();
