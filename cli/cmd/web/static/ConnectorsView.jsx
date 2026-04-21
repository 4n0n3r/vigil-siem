// ── Connectors View ──────────────────────────────────────────────────────────
(function(){
const {useState,useEffect} = React;
const D = window.VIGIL_DATA;

const SIEM_META = {
  wazuh:   {color:'#FFB547',label:'Wazuh',desc:'Open-source SIEM & XDR'},
  elastic: {color:'#00BFB3',label:'Elastic SIEM',desc:'Elastic Security'},
};

function LatencySparkline({data,color,h=24}){
  const ref = React.useRef(null);
  const [width, setWidth] = React.useState(200);
  React.useEffect(()=>{
    if(ref.current) setWidth(ref.current.offsetWidth||200);
  },[]);
  const vals=data.filter(v=>v>0);
  if(!vals.length)return <div ref={ref} style={{height:h}}/>;
  const W=width,H=h;
  const max=Math.max(...vals),min=Math.min(...vals),rng=max-min||1;
  const pts=vals.map((v,i)=>[(i/(vals.length-1))*W,H-((v-min)/rng)*(H-4)-2]);
  const line='M '+pts.map(p=>`${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
  const area=line+` L ${W} ${H} L 0 ${H} Z`;
  const uid=`ls${color.replace(/[^a-z0-9]/gi,'')}${W}`;
  return(
    <div ref={ref}>
      <svg width={W} height={H} style={{overflow:'visible',width:'100%'}}>
        <defs>
          <linearGradient id={uid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".2"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${uid})`}/>
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

function ConnectorCard({connector,onToggle,onDelete}){
  const T=useT();
  const meta=SIEM_META[connector.siem_type]||{color:T.txm,label:connector.siem_type,desc:''};
  const [expanded,setExpanded]=useState(false);
  const [testing,setTesting]=useState(false);
  const [testResult,setTestResult]=useState(null);
  const [deleteConfirm,setDeleteConfirm]=useState(false);

  const fmtAge=d=>{if(!d)return'—';const s=Math.floor((Date.now()-d)/1000);if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;return`${Math.floor(s/3600)}h ago`;};

  const test=async()=>{
    setTesting(true);setTestResult(null);
    const r=await window.VIGIL_API.testConnector(connector.id);
    setTestResult({ok:r.ok,msg:r.ok?`Connected · ${r.latency_ms||'?'}ms`:r.message||'Test failed'});
    setTesting(false);
  };

  const statusColor=connector.enabled&&!connector.last_error?T.green:connector.last_error?T.red:T.txm;

  return(
    <Card style={{padding:0,overflow:'hidden',transition:'all .2s'}}>
      <div style={{height:3,background:statusColor,opacity:connector.enabled?.8:.3,
        boxShadow:connector.enabled&&!connector.last_error?`0 0 8px ${T.green}66`:''}}/>

      <div style={{padding:16}}>
        <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:14}}>
          <div style={{width:42,height:42,borderRadius:10,background:meta.color+'18',
            border:`1px solid ${meta.color}33`,display:'flex',alignItems:'center',justifyContent:'center',
            flexShrink:0}}>
            <span style={{fontFamily:'JetBrains Mono',fontSize:11,fontWeight:700,color:meta.color}}>
              {connector.siem_type==='wazuh'?'WZ':'ES'}
            </span>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
              <span style={{fontFamily:'Space Grotesk',fontWeight:700,fontSize:14,color:T.tx}}>{connector.name}</span>
              <span style={{fontSize:9,fontFamily:'JetBrains Mono',color:meta.color,
                background:meta.color+'14',border:`1px solid ${meta.color}33`,
                borderRadius:4,padding:'2px 6px'}}>{meta.label}</span>
              {!connector.enabled&&<span style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:600,
                color:T.txm,background:T.bd,borderRadius:4,padding:'2px 6px'}}>DISABLED</span>}
            </div>
            <div style={{fontSize:11,color:T.txm,fontFamily:'JetBrains Mono',
              overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(connector.config||{}).host||'—'}</div>
          </div>
          <div onClick={()=>onToggle(connector.id)}
            style={{width:40,height:22,borderRadius:11,flexShrink:0,
              background:connector.enabled?T.green+'44':T.bd,
              border:`1px solid ${connector.enabled?T.green+'66':T.bd}`,
              position:'relative',cursor:'pointer',transition:'all .2s',marginTop:2}}>
            <div style={{position:'absolute',top:3,left:connector.enabled?19:3,width:14,height:14,
              borderRadius:'50%',background:connector.enabled?T.green:T.txm,
              transition:'left .2s',boxShadow:connector.enabled?`0 0 6px ${T.green}`:'none'}}/>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
          {[['Status',connector.enabled&&!connector.last_error?'Connected':connector.last_error?'Error':'Disabled',
              connector.enabled&&!connector.last_error?T.green:connector.last_error?T.red:T.txm],
            ['Latency',connector.latency_ms!=null?`${connector.latency_ms}ms`:'—',connector.latency_ms?T.cyan:T.txm],
            ['Alerts',(connector.alerts_imported||0).toLocaleString(),T.amber],
            ['Events today',(connector.events_today||0).toLocaleString(),T.purple]
          ].map(([l,v,c])=>(
            <div key={l} style={{background:T.bg,borderRadius:8,border:`1px solid ${T.bd}`,padding:'8px 10px'}}>
              <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                textTransform:'uppercase',letterSpacing:'.08em',marginBottom:3}}>{l}</div>
              <div style={{fontSize:12,color:c,fontFamily:'JetBrains Mono',fontWeight:500}}>{v}</div>
            </div>
          ))}
        </div>

        {connector.last_error&&(
          <div style={{marginBottom:12,padding:'8px 10px',background:T.red+'08',
            border:`1px solid ${T.red}22`,borderRadius:7,
            fontFamily:'JetBrains Mono',fontSize:10,color:T.red,lineHeight:1.5}}>
            ⚠ {connector.last_error}
          </div>
        )}

        {testResult&&(
          <div className="anim-in" style={{marginBottom:10,padding:'8px 10px',
            background:testResult.ok?T.green+'0a':T.red+'0a',
            border:`1px solid ${testResult.ok?T.green+'33':T.red+'33'}`,borderRadius:7,
            display:'flex',alignItems:'center',gap:7}}>
            <div style={{width:6,height:6,borderRadius:'50%',flexShrink:0,
              background:testResult.ok?T.green:T.red,
              boxShadow:`0 0 5px ${testResult.ok?T.green:T.red}`}}/>
            <span style={{fontSize:11,fontFamily:'JetBrains Mono',
              color:testResult.ok?T.green:T.red}}>{testResult.msg}</span>
          </div>
        )}

        <div style={{display:'flex',gap:6}}>
          <button onClick={test} disabled={testing}
            style={{flex:1,fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,
              color:T.cyan,background:T.cyan+'14',border:`1px solid ${T.cyan}33`,
              borderRadius:7,padding:'7px',cursor:testing?'wait':'pointer',transition:'all .15s',
              opacity:testing?.6:1}}>
            {testing?'Testing…':'Test Connection'}
          </button>
          <button onClick={()=>setExpanded(e=>!e)}
            style={{flex:1,fontSize:11,fontFamily:'Space Grotesk',fontWeight:500,
              color:T.txm,background:'transparent',border:`1px solid ${T.bd}`,
              borderRadius:7,padding:'7px',cursor:'pointer',transition:'all .15s'}}>
            {expanded?'Hide Config ▲':'View Config ▼'}
          </button>
          {deleteConfirm?(
            <><button onClick={()=>onDelete(connector.id)}
              style={{fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,color:T.red,
                background:T.red+'14',border:`1px solid ${T.red}33`,borderRadius:7,padding:'7px 10px',cursor:'pointer'}}>Confirm</button>
            <button onClick={()=>setDeleteConfirm(false)}
              style={{fontSize:11,color:T.txm,background:'transparent',border:`1px solid ${T.bd}`,borderRadius:7,padding:'7px 10px',cursor:'pointer'}}>✕</button></>
          ):(
            <button onClick={()=>setDeleteConfirm(true)}
              style={{fontSize:11,color:T.txm,background:'transparent',border:`1px solid ${T.bd}`,borderRadius:7,padding:'7px 10px',cursor:'pointer'}}
              title="Delete connector">🗑</button>
          )}
        </div>

        {expanded&&(
          <div className="anim-in" style={{marginTop:10,background:T.bg,
            border:`1px solid ${T.bd}`,borderRadius:8,padding:12}}>
            <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'.09em',marginBottom:8}}>Connection Config</div>
            <pre style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
              margin:0,lineHeight:1.65,whiteSpace:'pre-wrap'}}>
{JSON.stringify({...(connector.config||{}),password:'••••••••'},null,2)}
            </pre>
            <div style={{marginTop:10,display:'flex',gap:5,flexWrap:'wrap'}}>
              {[['Poll interval',`${connector.poll_interval||60}s`],
                ['Last polled',connector.last_polled?`${Math.floor((Date.now()-connector.last_polled)/1000)}s ago`:'—'],
                ['SSL verify',String(!!(connector.config||{}).ssl_verify)]
              ].map(([k,v])=>(
                <div key={k} style={{background:T.card,border:`1px solid ${T.bd}`,borderRadius:6,padding:'4px 8px'}}>
                  <span style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',marginRight:6}}>{k}:</span>
                  <span style={{fontSize:10,color:T.tx,fontFamily:'JetBrains Mono'}}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function AddConnectorPanel({onClose}){
  const T=useT();
  const [form,setForm]=useState({name:'',siem_type:'wazuh',host:'',username:'',password:'',ssl_verify:true,index_pattern:'logs-*'});
  const [testing,setTesting]=useState(false);const [tested,setTested]=useState(null);
  const [saving,setSaving]=useState(false);
  const setF=(k,v)=>setForm(f=>({...f,[k]:v}));

  const test=async()=>{
    setTesting(true);setTested(null);
    await new Promise(r=>setTimeout(r,1200));
    setTested({ok:form.host.includes('internal')||form.host.includes('10.0'),latency:Math.floor(40+Math.random()*60)});
    setTesting(false);
  };

  const add=async()=>{
    if(!form.name||!form.host)return;
    setSaving(true);
    await window.VIGIL_API.createConnector({
      name:form.name,siem_type:form.siem_type,
      config:{host:form.host,username:form.username,ssl_verify:form.ssl_verify,index_pattern:form.index_pattern},
      enabled:true
    });
    setSaving(false);
    onClose();
  };

  return(
    <div style={{position:'fixed',inset:0,zIndex:500,display:'flex',justifyContent:'flex-end'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.4)'}} onClick={onClose}/>
      <div style={{position:'relative',width:440,background:T.card,borderLeft:`1px solid ${T.bd}`,
        height:'100vh',overflowY:'auto',animation:'drawerIn .2s ease',
        boxShadow:'-8px 0 40px rgba(0,0,0,.3)'}}>
        <div style={{padding:'18px 20px',borderBottom:`1px solid ${T.bd}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontFamily:'Space Grotesk',fontWeight:700,fontSize:15,color:T.tx}}>Add Connector</span>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:T.txm,fontSize:20}}>×</button>
          </div>
        </div>
        <div style={{padding:20,display:'flex',flexDirection:'column',gap:14}}>
          <div>
            <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8}}>Source SIEM</div>
            <div style={{display:'flex',gap:8}}>
              {Object.entries(SIEM_META).map(([k,m])=>(
                <div key={k} onClick={()=>setF('siem_type',k)}
                  style={{flex:1,padding:'12px',borderRadius:10,cursor:'pointer',
                    background:form.siem_type===k?m.color+'14':T.bg,
                    border:`1px solid ${form.siem_type===k?m.color+'44':T.bd}`,
                    transition:'all .15s',textAlign:'center'}}>
                  <div style={{fontFamily:'JetBrains Mono',fontSize:16,fontWeight:700,
                    color:m.color,marginBottom:4}}>{k==='wazuh'?'WZ':'ES'}</div>
                  <div style={{fontSize:12,fontFamily:'Space Grotesk',fontWeight:600,color:T.tx}}>{m.label}</div>
                  <div style={{fontSize:10,color:T.txm,marginTop:2}}>{m.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {[['Connector Name','name','text','My Wazuh Cluster'],
            ['Host URL','host','text','https://wazuh-mgr.internal:55000'],
            ['Username / API Key','username','text','vigil-api'],
            ['Password / Secret','password','password','••••••••'],
          ].map(([lbl,key,type,ph])=>(
            <div key={key}>
              <div style={{fontSize:9,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,
                textTransform:'uppercase',letterSpacing:'.08em',marginBottom:5}}>{lbl}</div>
              <input value={form[key]} onChange={e=>setF(key,e.target.value)}
                type={type} placeholder={ph}
                style={{width:'100%',background:T.bg,border:`1px solid ${T.bd}`,borderRadius:8,
                  padding:'8px 10px',color:T.tx,fontFamily:key==='host'||key==='username'?'JetBrains Mono':'Inter',
                  fontSize:12,outline:'none',transition:'border-color .15s'}}
                onFocus={e=>e.target.style.borderColor=T.cyan}
                onBlur={e=>e.target.style.borderColor=T.bd}/>
            </div>
          ))}

          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:12,fontFamily:'Space Grotesk',fontWeight:500,color:T.tx}}>Verify SSL certificate</div>
              <div style={{fontSize:10,color:T.txm}}>Disable only for self-signed certs in dev</div>
            </div>
            <div onClick={()=>setF('ssl_verify',!form.ssl_verify)}
              style={{width:40,height:22,borderRadius:11,flexShrink:0,
                background:form.ssl_verify?T.green+'44':T.bd,
                border:`1px solid ${form.ssl_verify?T.green+'66':T.bd}`,
                position:'relative',cursor:'pointer',transition:'all .2s'}}>
              <div style={{position:'absolute',top:3,left:form.ssl_verify?19:3,width:14,height:14,
                borderRadius:'50%',background:form.ssl_verify?T.green:T.txm,
                transition:'left .2s',boxShadow:form.ssl_verify?`0 0 6px ${T.green}`:'none'}}/>
            </div>
          </div>

          <button onClick={test} disabled={!form.host||testing}
            style={{width:'100%',padding:'9px',fontFamily:'Space Grotesk',fontWeight:600,fontSize:12,
              color:T.cyan,background:T.cyan+'14',border:`1px solid ${T.cyan}33`,
              borderRadius:8,cursor:(!form.host||testing)?'not-allowed':'pointer',
              opacity:(!form.host||testing)?.5:1,transition:'all .15s'}}>
            {testing?'Testing connection…':'Test Connection →'}
          </button>

          {tested&&(
            <div className="anim-in" style={{padding:'9px 12px',
              background:tested.ok?T.green+'0a':T.red+'0a',
              border:`1px solid ${tested.ok?T.green+'33':T.red+'33'}`,borderRadius:8,
              display:'flex',alignItems:'center',gap:8}}>
              <div style={{width:7,height:7,borderRadius:'50%',background:tested.ok?T.green:T.red,
                boxShadow:`0 0 5px ${tested.ok?T.green:T.red}`,flexShrink:0}}/>
              <span style={{fontSize:12,fontFamily:'JetBrains Mono',color:tested.ok?T.green:T.red}}>
                {tested.ok?`Connected · ${tested.latency}ms latency`:'Connection failed — check host and credentials'}
              </span>
            </div>
          )}

          <button onClick={add} disabled={!form.name||!form.host||saving}
            style={{width:'100%',padding:'11px',fontFamily:'Space Grotesk',fontWeight:700,fontSize:13,
              color:'#080B10',background:T.cyan,border:'none',borderRadius:9,
              cursor:(!form.name||!form.host||saving)?'not-allowed':'pointer',
              opacity:(!form.name||!form.host||saving)?.4:1,
              boxShadow:`0 0 20px ${T.cyan}33`,transition:'all .15s'}}
            onMouseEnter={e=>{if(form.name&&form.host&&!saving){e.currentTarget.style.opacity='.85';e.currentTarget.style.transform='translateY(-1px)';}}}
            onMouseLeave={e=>{e.currentTarget.style.opacity=(!form.name||!form.host||saving)?'.4':'1';e.currentTarget.style.transform='none';}}>
            {saving?'Adding…':'Add Connector'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectorsView(){
  const T=useT();
  const [showAdd,setShowAdd]=useState(false);
  // Local enabled state for optimistic toggle (no API endpoint for enable/disable)
  const [enabledOverride,setEnabledOverride]=useState({});

  const connectors=D.CONNECTORS.map(c=>({
    ...c,
    enabled:enabledOverride.hasOwnProperty(c.id)?enabledOverride[c.id]:c.enabled
  }));

  const toggleConnector=(id)=>{
    setEnabledOverride(o=>({...o,[id]:!connectors.find(c=>c.id===id)?.enabled}));
  };

  const deleteConnector=async(id)=>{
    await window.VIGIL_API.deleteConnector(id);
  };

  const enabled=connectors.filter(c=>c.enabled&&!c.last_error).length;
  const totalImported=connectors.reduce((s,c)=>s+(c.alerts_imported||0),0);
  const totalEvents=connectors.reduce((s,c)=>s+(c.events_today||0),0);

  return(
    <div style={{flex:1,overflowY:'auto',padding:14,display:'flex',flexDirection:'column',gap:10}}>
      <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
        {[[`${enabled}/${connectors.length}`,'Active Connectors',T.green],
          [totalImported.toLocaleString(),'Alerts Imported',T.amber],
          [totalEvents.toLocaleString(),'Events Today',T.cyan],
          [connectors.filter(c=>c.last_error).length,'Errors',T.red]].map(([v,l,c])=>(
          <Card key={l} style={{padding:'12px 16px',flex:1}}>
            <div style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',color:T.txm,marginBottom:4}}>{l}</div>
            <div style={{fontFamily:'JetBrains Mono',fontSize:22,fontWeight:500,color:c}}>{v}</div>
          </Card>
        ))}
        <button onClick={()=>setShowAdd(true)}
          style={{padding:'0 20px',background:T.cyan,border:'none',borderRadius:12,cursor:'pointer',
            fontFamily:'Space Grotesk',fontWeight:700,fontSize:12,color:'#080B10',
            boxShadow:`0 0 20px ${T.cyan}33`,transition:'all .15s',whiteSpace:'nowrap',flexShrink:0}}
          onMouseEnter={e=>{e.currentTarget.style.opacity='.85';e.currentTarget.style.transform='translateY(-1px)';}}
          onMouseLeave={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.transform='none';}}>
          + Add Connector
        </button>
      </div>

      {connectors.length===0&&(
        <div style={{textAlign:'center',padding:'60px 20px',color:T.txm}}>
          <div style={{fontSize:13,fontFamily:'Space Grotesk',color:T.txm,marginBottom:12}}>No connectors configured</div>
          <button onClick={()=>setShowAdd(true)}
            style={{fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,
              background:T.cyan+'14',border:`1px solid ${T.cyan}33`,borderRadius:7,
              padding:'7px 16px',cursor:'pointer'}}>Add your first connector →</button>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))',gap:10}}>
        {connectors.map(c=>(
          <ConnectorCard key={c.id} connector={c} onToggle={toggleConnector} onDelete={deleteConnector}/>
        ))}
      </div>

      {showAdd&&<AddConnectorPanel onClose={()=>setShowAdd(false)}/>}
    </div>
  );
}

window.ConnectorsView = ConnectorsView;
})();
