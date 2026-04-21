// ── Live Feed View ──────────────────────────────────────────────────────────
(function(){
const {useState,useEffect,useRef} = React;
const D = window.VIGIL_DATA;

function LiveFeedView(){
  const T=useT();const SC=useSev();
  const [feed,setFeed]=useState(()=>D.FEED.slice());
  const [sevFilter,setSevFilter]=useState('all');
  const [connFilter,setConnFilter]=useState('all');
  const [autoScroll,setAutoScroll]=useState(true);
  const [expanded,setExpanded]=useState(null);
  const [paused,setPaused]=useState(false);
  const listRef=useRef(null);
  const counterRef=useRef(0);

  // Sync from VIGIL_BUS
  useEffect(()=>{
    return window.VIGIL_BUS.subscribe(()=>{
      if(!paused) setFeed(D.FEED.slice());
    });
  },[paused]);

  // Simulate live incoming events when no connectors produce real feed
  useEffect(()=>{
    if(paused)return;
    const iv=setInterval(()=>{
      const sevs=['critical','high','high','medium','medium','medium','low'];
      const titles=['Authentication failure','Privilege escalation attempt','Suspicious outbound DNS',
        'Process injection detected','New network connection','File integrity alert','SSH brute force'];
      const hosts=['web-prod-01','db-primary','bastion-01','k8s-node-03'];
      const connectors=D.CONNECTORS.filter(c=>c.enabled);
      if(connectors.length===0)return;
      const connector=connectors[Math.floor(Math.random()*connectors.length)];
      counterRef.current++;
      const newAlert={
        connector_id:connector.id, connector_name:connector.name, source_siem:connector.siem_type,
        native_id:`live-${counterRef.current}`,
        severity:sevs[Math.floor(Math.random()*sevs.length)],
        title:titles[Math.floor(Math.random()*titles.length)],
        hostname:hosts[Math.floor(Math.random()*hosts.length)],
        source_ip:`${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
        detected_at:new Date(),
        raw:{rule:{level:Math.floor(Math.random()*12)+1},data:{live:true}}
      };
      setFeed(f=>[newAlert,...f].slice(0,200));
    },3500);
    return()=>clearInterval(iv);
  },[paused]);

  useEffect(()=>{
    if(autoScroll&&listRef.current)listRef.current.scrollTop=0;
  },[feed,autoScroll]);

  const visible=feed.filter(a=>{
    if(sevFilter!=='all'&&a.severity!==sevFilter)return false;
    if(connFilter!=='all'&&a.connector_id!==connFilter)return false;
    return true;
  });

  const fmtTime=d=>d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  const siemColors={wazuh:T.amber,elastic:T.purple};

  const counts={
    critical:feed.filter(a=>a.severity==='critical').length,
    high:feed.filter(a=>a.severity==='high').length,
    medium:feed.filter(a=>a.severity==='medium').length,
    low:feed.filter(a=>a.severity==='low').length
  };

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',padding:14,gap:10}}>
      <div style={{display:'flex',gap:8}}>
        {[['Critical',counts.critical,SC.critical],['High',counts.high,SC.high],
          ['Medium',counts.medium,SC.medium],['Low',counts.low,SC.low]].map(([l,v,c])=>(
          <Card key={l} style={{padding:'10px 14px',flex:1,cursor:'pointer',
            border:sevFilter===l.toLowerCase()?`1px solid ${c}44`:undefined}}
            onClick={()=>setSevFilter(sevFilter===l.toLowerCase()?'all':l.toLowerCase())}>
            <div style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',color:T.txm,marginBottom:4}}>{l}</div>
            <div style={{fontFamily:'JetBrains Mono',fontSize:22,fontWeight:500,color:sevFilter===l.toLowerCase()?c:T.tx}}>{v}</div>
          </Card>
        ))}
        <Card style={{padding:'10px 14px',flex:2}}>
          <div style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',color:T.txm,marginBottom:6}}>Source</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            <Pill label="All" active={connFilter==='all'} onClick={()=>setConnFilter('all')}/>
            {D.CONNECTORS.filter(c=>c.enabled).map(c=>(
              <Pill key={c.id} label={c.name} active={connFilter===c.id} onClick={()=>setConnFilter(connFilter===c.id?'all':c.id)} color={siemColors[c.siem_type]}/>
            ))}
          </div>
        </Card>
        <Card style={{padding:'10px 14px',display:'flex',flexDirection:'column',justifyContent:'space-between',minWidth:130}}>
          <div style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',color:T.txm}}>Stream</div>
          <div style={{display:'flex',gap:6,marginTop:6}}>
            <button onClick={()=>setPaused(p=>!p)}
              style={{flex:1,fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,
                color:paused?T.amber:T.green,background:(paused?T.amber:T.green)+'14',
                border:`1px solid ${(paused?T.amber:T.green)}33`,borderRadius:6,padding:'5px',cursor:'pointer'}}>
              {paused?'▶ Resume':'⏸ Pause'}
            </button>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:5,marginTop:6,cursor:'pointer'}}
            onClick={()=>setAutoScroll(s=>!s)}>
            <div style={{width:12,height:12,borderRadius:3,background:autoScroll?T.cyan+'22':'transparent',
              border:`1px solid ${autoScroll?T.cyan:T.bd}`,display:'flex',alignItems:'center',justifyContent:'center'}}>
              {autoScroll&&<div style={{width:6,height:6,borderRadius:1,background:T.cyan}}/>}
            </div>
            <span style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk'}}>Auto-scroll</span>
          </div>
        </Card>
      </div>

      <Card style={{flex:1,overflow:'hidden',padding:0,display:'flex',flexDirection:'column'}}>
        <div style={{padding:'10px 16px',borderBottom:T.cardBorder,display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            {!paused&&<div style={{width:6,height:6,borderRadius:'50%',background:T.green,
              boxShadow:`0 0 6px ${T.green}`,animation:'pdot 1.2s infinite'}}/>}
            <span style={{fontSize:12,fontFamily:'Space Grotesk',fontWeight:600,color:T.tx}}>
              {paused?'Stream paused':'Live stream'}</span>
          </div>
          <span style={{fontSize:10,color:T.txm,fontFamily:'JetBrains Mono'}}>{visible.length} events · {D.CONNECTORS.filter(c=>c.enabled).length} connectors</span>
          <button onClick={()=>setFeed([])} style={{marginLeft:'auto',fontSize:10,fontFamily:'Space Grotesk',color:T.txm,background:'transparent',border:T.cardBorder,borderRadius:5,padding:'3px 10px',cursor:'pointer'}}>Clear</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'72px 80px 70px 1fr 120px 100px',
          gap:0,padding:'5px 16px',borderBottom:T.cardBorder,flexShrink:0}}>
          {['Time','Source','Sev','Title','Host','Src IP'].map(h=>(
            <span key={h} style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,
              textTransform:'uppercase',letterSpacing:'.08em',color:T.txm}}>{h}</span>
          ))}
        </div>
        <div ref={listRef} style={{flex:1,overflowY:'auto'}}>
          {visible.length===0&&(
            <div style={{padding:'40px',textAlign:'center',color:T.txm,fontSize:11,fontFamily:'Inter'}}>
              Waiting for events…
            </div>
          )}
          {visible.map((a,i)=>(
            <div key={a.native_id+i}>
              <div onClick={()=>setExpanded(expanded===a.native_id?null:a.native_id)}
                style={{display:'grid',gridTemplateColumns:'72px 80px 70px 1fr 120px 100px',
                  gap:0,padding:'7px 16px',cursor:'pointer',transition:'background .1s',
                  borderBottom:`1px solid ${T.bd}`,
                  background:i===0&&!paused?T.cyan+'06':expanded===a.native_id?T.el:'transparent',
                  animation:i===0&&!paused?'highlightIn .5s ease':'none'}}
                onMouseEnter={e=>e.currentTarget.style.background=T.el}
                onMouseLeave={e=>e.currentTarget.style.background=expanded===a.native_id?T.el:'transparent'}>
                <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,alignSelf:'center'}}>{fmtTime(a.detected_at)}</span>
                <span style={{alignSelf:'center'}}>
                  <span style={{fontSize:9,fontFamily:'JetBrains Mono',
                    color:siemColors[a.source_siem]||T.txm,background:(siemColors[a.source_siem]||T.txm)+'14',
                    border:`1px solid ${(siemColors[a.source_siem]||T.txm)}33`,
                    borderRadius:4,padding:'2px 5px'}}>{a.source_siem||'—'}</span>
                </span>
                <span style={{alignSelf:'center'}}><SevBadge sev={a.severity}/></span>
                <span style={{fontSize:12,color:T.tx,alignSelf:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',paddingRight:10}}>{a.title}</span>
                <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,alignSelf:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.hostname||'—'}</span>
                <span style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.txm,alignSelf:'center'}}>{a.source_ip||'—'}</span>
              </div>
              {expanded===a.native_id&&(
                <div style={{padding:'10px 16px 14px',background:T.bg,borderBottom:T.cardBorder}}>
                  <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                    <pre style={{fontFamily:'JetBrains Mono',fontSize:10,color:T.cyan,
                      background:T.card,border:T.cardBorder,borderRadius:8,padding:12,
                      flex:1,overflow:'auto',maxHeight:140,lineHeight:1.6,margin:0}}>
{JSON.stringify(a.raw,null,2)}
                    </pre>
                    <div style={{width:200,flexShrink:0}}>
                      <div style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,marginBottom:8,textTransform:'uppercase',letterSpacing:'.08em'}}>Quick Actions</div>
                      {['Acknowledge','Suppress','Open in Hunt'].map(lbl=>(
                        <button key={lbl} style={{display:'block',width:'100%',marginBottom:5,
                          fontSize:11,fontFamily:'Space Grotesk',fontWeight:500,color:lbl==='Open in Hunt'?T.cyan:T.txm,
                          background:lbl==='Open in Hunt'?T.cyan+'14':'transparent',border:T.cardBorder,
                          borderRadius:6,padding:'6px',cursor:'pointer',textAlign:'left',transition:'all .1s'}}>{lbl}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

window.LiveFeedView = LiveFeedView;
})();
