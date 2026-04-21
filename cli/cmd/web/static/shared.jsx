// Shared components — exported to window
(function(){
const {useState,useEffect,useRef,createContext,useContext} = React;

const ThemeCtx = createContext('dark');
const useT = () => {
  const t = useContext(ThemeCtx);
  return t === 'dark' ? {
    bg:'#080B10',card:'#0E1117',el:'#161B22',bd:'#1E2633',
    tx:'#E2E8F0',txm:'#718096',
    cyan:'#00E5FF',red:'#F85149',amber:'#FFB547',
    green:'#3FB950',yellow:'#E6C84A',purple:'#A78BFA',
    shadow:'none',cardBorder:'1px solid #1E2633',
  } : {
    bg:'#F8FAFC',card:'#FFFFFF',el:'#F1F5F9',bd:'rgba(15,23,42,.08)',
    tx:'#0F172A',txm:'#64748B',
    cyan:'#0891B2',red:'#DC2626',amber:'#D97706',
    green:'#16A34A',yellow:'#CA8A04',purple:'#7C3AED',
    shadow:'0 1px 4px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04)',cardBorder:'1px solid rgba(15,23,42,.07)',
  };
};

const SEV_C_DARK  = {critical:'#F85149',high:'#FFB547',medium:'#E6C84A',low:'#3FB950'};
const SEV_C_LIGHT = {critical:'#DC2626',high:'#D97706',medium:'#CA8A04',low:'#16A34A'};
const useSev = () => useContext(ThemeCtx) === 'dark' ? SEV_C_DARK : SEV_C_LIGHT;
const sevBg  = (c) => c + (window.__theme === 'dark' ? '14' : '12');

function Logo({size=22,word=true}){
  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
        style={{filter:'drop-shadow(0 0 5px rgba(0,229,255,.45))'}}>
        <path d="M4 20 C10 8, 30 8, 36 20" stroke="#E2E8F0" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        <circle cx="20" cy="20" r="5" fill="#00E5FF" style={{filter:'drop-shadow(0 0 6px #00E5FF)'}}/>
        <circle cx="20" cy="20" r="2" fill="#080B10"/>
      </svg>
      {word && <span style={{fontFamily:'Space Grotesk',fontWeight:700,fontSize:15,color:'var(--tx)',letterSpacing:'-.02em'}}>vigil</span>}
    </div>
  );
}

function Sparkline({data,color,w=68,h=24}){
  if(!data||!data.length)return null;
  const max=Math.max(...data),min=Math.min(...data),rng=max-min||1;
  const pts=data.map((v,i)=>[(i/(data.length-1))*w,h-((v-min)/rng)*(h-4)-2]);
  const line='M '+pts.map(p=>`${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
  const area=line+` L ${w} ${h} L 0 ${h} Z`;
  const uid=`sp${color.replace(/[^a-z0-9]/gi,'')}${w}`;
  return (
    <svg width={w} height={h} style={{overflow:'visible',flexShrink:0}}>
      <defs>
        <linearGradient id={uid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`}/>
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

function StatCard({label,value,sub,color,spark,glow,pulse}){
  const T=useT();const[hov,setHov]=useState(false);
  const v=typeof value==='number'?value.toLocaleString():value;
  return (
    <div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{background:hov?T.el:T.card,borderRadius:12,padding:'12px 14px',flex:1,minWidth:0,
        border:glow?`1px solid ${color}44`:T.cardBorder,
        boxShadow:glow?`0 0 20px ${color}14`:T.shadow,
        transition:'all .15s',animation:pulse?'glowin 2s infinite':'none'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
        <span style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',
          letterSpacing:'.1em',color:T.txm}}>{label}</span>
        {pulse&&<div style={{width:5,height:5,borderRadius:'50%',background:color,
          boxShadow:`0 0 6px ${color}`,animation:'pdot 1.5s infinite'}}/>}
      </div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:8}}>
        <div>
          <div style={{fontFamily:'JetBrains Mono',fontSize:24,fontWeight:500,
            color:glow?color:T.tx,lineHeight:1,letterSpacing:'-.02em'}}>{v}</div>
          {sub&&<div style={{fontSize:10,color:T.txm,marginTop:3}}>{sub}</div>}
        </div>
        {spark&&<Sparkline data={spark} color={color}/>}
      </div>
    </div>
  );
}

function SevBadge({sev,size='sm'}){
  const SC=useSev();const c=SC[sev]||'#888';
  const pad=size==='sm'?'2px 7px':'3px 10px';const fs=size==='sm'?9:11;
  return (
    <span style={{fontSize:fs,fontFamily:'JetBrains Mono',fontWeight:500,
      color:c,background:c+'14',border:`1px solid ${c}33`,
      borderRadius:4,padding:pad,textTransform:'uppercase',whiteSpace:'nowrap'}}>{sev}</span>
  );
}

function Card({children,style={},className=''}){
  const T=useT();
  return (
    <div className={className} style={{background:T.card,border:T.cardBorder,borderRadius:12,boxShadow:T.shadow,...style}}>
      {children}
    </div>
  );
}

function SectionHead({title,right,style={}}){
  const T=useT();
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,...style}}>
      <span style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:13,color:T.tx}}>{title}</span>
      {right&&<div style={{display:'flex',alignItems:'center',gap:6}}>{right}</div>}
    </div>
  );
}

function Pill({label,active,onClick,color}){
  const T=useT();const ac=color||T.cyan;
  return (
    <button onClick={onClick} style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:500,
      color:active?ac:T.txm,background:active?ac+'18':'transparent',
      border:`1px solid ${active?ac+'44':T.bd}`,borderRadius:5,padding:'3px 10px',cursor:'pointer',transition:'all .12s'}}>
      {label}
    </button>
  );
}

function Topbar({title,subtitle,range,setRange,theme,toggleTheme}){
  const T=useT();
  const crit=(window.VIGIL_DATA.ALERTS||[]).filter(a=>a.status==='open'&&a.severity==='critical').length;
  return (
    <div style={{height:50,borderBottom:T.cardBorder,display:'flex',alignItems:'center',
      padding:'0 18px',gap:10,background:T.card,flexShrink:0,boxShadow:T.shadow}}>
      <div>
        <span style={{fontFamily:'Space Grotesk',fontWeight:700,fontSize:15,color:T.tx}}>{title}</span>
        {subtitle&&<span style={{fontSize:10,color:T.txm,marginLeft:8,fontFamily:'JetBrains Mono'}}>{subtitle}</span>}
      </div>
      {crit>0&&(
        <div style={{display:'flex',alignItems:'center',gap:5,padding:'3px 10px',
          background:'rgba(248,81,73,.08)',border:'1px solid rgba(248,81,73,.25)',borderRadius:20}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:'#F85149',animation:'pdot .9s infinite'}}/>
          <span style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:'#F85149'}}>{crit} critical open</span>
        </div>
      )}
      <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
        {range!==undefined&&(
          <div style={{display:'flex',gap:3}}>
            {['1H','24H','7D'].map(r=>(
              <Pill key={r} label={r} active={range===r} onClick={()=>setRange(r)}/>
            ))}
          </div>
        )}
        <button onClick={toggleTheme}
          style={{background:T.el,border:T.cardBorder,borderRadius:6,
            padding:'4px 10px',cursor:'pointer',fontSize:13,color:T.txm,boxShadow:T.shadow}}>
          {theme==='dark'?'☀':'🌙'}
        </button>
      </div>
    </div>
  );
}

const NAV=[
  {sep:'Monitor'},
  {id:'dashboard',label:'Dashboard',path:'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6'},
  {id:'feed',label:'Live Feed',path:'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9'},
  {id:'alerts',label:'Alerts',path:'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',badgeKey:'crit'},
  {sep:'Investigate'},
  {id:'hunt',label:'Hunt',path:'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'},
  {id:'rules',label:'Detection Rules',path:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2'},
  {id:'suppressions',label:'Suppressions',path:'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636'},
  {sep:'Infrastructure'},
  {id:'agents',label:'Agents',path:'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18'},
  {id:'connectors',label:'Connectors',path:'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1'},
];

function Sidebar({active,onNav}){
  const T=useT();
  const crit=(window.VIGIL_DATA.ALERTS||[]).filter(a=>a.status==='open'&&a.severity==='critical').length;
  const apiOk=window.VIGIL_DATA._apiOk;
  return (
    <div style={{width:196,background:T.card,borderRight:T.cardBorder,display:'flex',
      flexDirection:'column',flexShrink:0,height:'100vh',boxShadow:T.shadow}}>
      <div style={{padding:'14px 14px 12px',borderBottom:T.cardBorder}}>
        <Logo size={22}/>
      </div>
      <nav style={{padding:'6px 8px',flex:1,overflowY:'auto'}}>
        {NAV.map((item,i)=>{
          if(item.sep)return(
            <div key={i} style={{fontSize:9,fontFamily:'Space Grotesk',fontWeight:700,
              color:T.txm,letterSpacing:'.1em',textTransform:'uppercase',padding:'12px 8px 4px'}}>{item.sep}</div>
          );
          const isA=active===item.id;
          const badge=item.badgeKey==='crit'?crit:0;
          return(
            <div key={item.id} onClick={()=>onNav(item.id)}
              style={{display:'flex',alignItems:'center',gap:9,padding:'7px 8px',borderRadius:7,
                cursor:'pointer',background:isA?T.cyan+'14':'transparent',
                border:`1px solid ${isA?T.cyan+'33':'transparent'}`,
                color:isA?T.cyan:T.txm,marginBottom:1,transition:'all .12s'}}
              onMouseEnter={e=>{if(!isA){e.currentTarget.style.background=T.el;e.currentTarget.style.color=T.tx;}}}
              onMouseLeave={e=>{if(!isA){e.currentTarget.style.background='transparent';e.currentTarget.style.color=T.txm;}}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={item.path}/></svg>
              <span style={{fontSize:12,fontFamily:'Space Grotesk',fontWeight:isA?600:400,flex:1}}>{item.label}</span>
              {badge>0&&<span style={{fontSize:9,fontFamily:'JetBrains Mono',color:'#F85149',
                background:'rgba(248,81,73,.12)',border:'1px solid rgba(248,81,73,.3)',
                borderRadius:4,padding:'1px 5px'}}>{badge}</span>}
            </div>
          );
        })}
      </nav>
      <div style={{padding:10,borderTop:T.cardBorder}}>
        <div style={{display:'flex',alignItems:'center',gap:7,padding:'7px 8px',
          background:T.bg,borderRadius:8,border:T.cardBorder,boxShadow:T.shadow}}>
          <div style={{width:6,height:6,borderRadius:'50%',
            background:apiOk?T.green:T.red,
            boxShadow:`0 0 5px ${apiOk?T.green:T.red}`,
            animation:apiOk?'pdot 2s infinite':'none',flexShrink:0}}/>
          <div style={{minWidth:0}}>
            <div style={{fontSize:10,color:T.tx,fontFamily:'Space Grotesk',fontWeight:600}}>
              {apiOk?'API Connected':'Connecting…'}
            </div>
            <div style={{fontSize:9,color:T.txm,fontFamily:'JetBrains Mono',overflow:'hidden',
              textOverflow:'ellipsis',whiteSpace:'nowrap'}}>localhost:8001</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertDrawer({alert,onClose,theme,onOpenInvestigation}){
  const T=useT();const SC=useSev();
  const [aiText,setAiText]=useState('');const [aiLoading,setAiLoading]=useState(false);const [aiDone,setAiDone]=useState(false);
  if(!alert)return null;

  const analyze=async()=>{
    setAiLoading(true);setAiText('');setAiDone(false);
    try{
      const r=await window.claude.complete(`SOC analyst — triage this alert concisely.\n\nRule: ${alert.rule_name}\nSeverity: ${alert.severity.toUpperCase()}\nHost: ${alert.endpoint_id}  Process: ${alert.event_snapshot.process}  User: ${alert.event_snapshot.user}\nSrc IP: ${alert.event_snapshot.src_ip}  CMD: ${alert.event_snapshot.cmdline}\nMITRE: ${alert.event_snapshot.tactic}\n\nProvide: (1) What happened — 2 sentences. (2) Immediate recommended action. (3) False-positive likelihood. Direct and technical.`);
      setAiText(r);setAiDone(true);
    }catch(e){setAiText('AI agent unavailable — ' + (e.message||'check connection'));}
    setAiLoading(false);
  };

  const doAction=async(action)=>{
    if(action==='Acknowledge') await window.VIGIL_API.acknowledgeAlert(alert.id);
    else if(action==='Resolve') await window.VIGIL_API.batchAlerts([alert.id],'resolve');
    onClose();
  };

  return(
    <div style={{position:'fixed',inset:0,zIndex:500,display:'flex',justifyContent:'flex-end'}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.4)'}} onClick={onClose}/>
      <div style={{position:'relative',width:460,background:T.card,borderLeft:T.cardBorder,
        height:'100vh',overflowY:'auto',display:'flex',flexDirection:'column',
        animation:'drawerIn .2s ease',boxShadow:'-8px 0 40px rgba(0,0,0,.3)'}}>
        <div style={{padding:'16px 20px',borderBottom:T.cardBorder,flexShrink:0}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
            <div style={{flex:1,minWidth:0,marginRight:12}}>
              <SevBadge sev={alert.severity} size="md"/>
              <div style={{fontFamily:'Space Grotesk',fontWeight:600,fontSize:14,
                color:T.tx,marginTop:8,lineHeight:1.3}}>{alert.rule_name}</div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:T.txm,fontSize:20,lineHeight:1,padding:2,flexShrink:0}}>×</button>
          </div>
          <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
            {[['Host',alert.endpoint_id],['User',alert.event_snapshot.user],
              ['Process',alert.event_snapshot.process],['MITRE',alert.event_snapshot.tactic]
            ].map(([k,v])=>(
              <div key={k} style={{background:T.el,borderRadius:6,padding:'4px 8px',border:T.cardBorder}}>
                <div style={{fontSize:8,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em'}}>{k}</div>
                <div style={{fontSize:11,color:T.tx,fontFamily:'JetBrains Mono',marginTop:1}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{padding:'14px 20px',borderBottom:T.cardBorder}}>
          <div style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',marginBottom:8}}>Event Snapshot</div>
          <pre style={{fontFamily:'JetBrains Mono',fontSize:11,color:T.cyan,
            background:T.bg,borderRadius:8,border:T.cardBorder,padding:12,
            overflow:'auto',whiteSpace:'pre-wrap',lineHeight:1.6,maxHeight:160}}>
{JSON.stringify({src_ip:alert.event_snapshot.src_ip,dst_ip:alert.event_snapshot.dst_ip,process:alert.event_snapshot.process,user:alert.event_snapshot.user,cmdline:alert.event_snapshot.cmdline,pid:alert.event_snapshot.pid},null,2)}
          </pre>
        </div>
        <div style={{padding:'14px 20px',borderBottom:T.cardBorder,flex:1}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:5,height:5,borderRadius:'50%',background:T.cyan,boxShadow:`0 0 6px ${T.cyan}`,animation:'pdot 2s infinite'}}/>
              <span style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em'}}>AI Analysis</span>
            </div>
            {!aiDone&&<button onClick={analyze} disabled={aiLoading}
              style={{fontSize:10,fontFamily:'Space Grotesk',fontWeight:600,color:T.cyan,background:T.cyan+'14',border:`1px solid ${T.cyan}44`,borderRadius:6,padding:'4px 12px',cursor:aiLoading?'not-allowed':'pointer'}}>
              {aiLoading?'Analyzing…':'Analyze with AI →'}</button>}
          </div>
          {aiLoading&&<div style={{display:'flex',flexDirection:'column',gap:7}}>{[80,60,70,45].map((w,i)=><div key={i} className="shimmer-line" style={{height:9,borderRadius:4,width:`${w}%`}}/>)}</div>}
          {aiText&&<p style={{fontSize:12,color:T.tx,lineHeight:1.7,whiteSpace:'pre-wrap'}}>{aiText}</p>}
          {!aiText&&!aiLoading&&<p style={{fontSize:11,color:T.txm,fontStyle:'italic'}}>Click "Analyze with AI" to get triage guidance from your local agent.</p>}
        </div>
        <div style={{padding:'14px 20px',flexShrink:0,borderTop:T.cardBorder}}>
          <div style={{fontSize:10,color:T.txm,fontFamily:'Space Grotesk',fontWeight:700,textTransform:'uppercase',letterSpacing:'.09em',marginBottom:10}}>Actions</div>
          <div style={{display:'flex',gap:8,flexDirection:'column'}}>
            <div style={{display:'flex',gap:8}}>
              {[['Acknowledge','#3FB950'],['Suppress','#FFB547'],['Resolve','#00E5FF']].map(([lbl,clr])=>(
                <button key={lbl} onClick={()=>doAction(lbl)}
                  style={{flex:1,fontSize:11,fontFamily:'Space Grotesk',fontWeight:600,color:clr,background:clr+'14',border:`1px solid ${clr}44`,borderRadius:7,padding:'8px',cursor:'pointer',transition:'all .12s'}}
                  onMouseEnter={e=>e.currentTarget.style.background=clr+'28'}
                  onMouseLeave={e=>e.currentTarget.style.background=clr+'14'}>{lbl}</button>
              ))}
            </div>
            <button onClick={()=>onOpenInvestigation&&onOpenInvestigation(alert)}
              style={{width:'100%',fontSize:12,fontFamily:'Space Grotesk',fontWeight:600,color:T.bg,background:T.cyan,border:'none',borderRadius:7,padding:'9px',cursor:'pointer',boxShadow:`0 0 16px ${T.cyan}44`,transition:'all .12s',letterSpacing:'.01em'}}
              onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
              onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
              Open Full Investigation →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window,{
  ThemeCtx,useT,useSev,SEV_C_DARK,SEV_C_LIGHT,sevBg,
  Logo,Sparkline,StatCard,SevBadge,Card,SectionHead,Pill,
  Topbar,Sidebar,AlertDrawer,
});
})();
