const express=require('express'),fs=require('fs'),crypto=require('crypto');
const app=express();app.use(express.json({limit:'300kb'}));const ORIGIN=process.env.ORIGIN||'*';
app.use((req,res,next)=>{res.set({'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});if(req.method==='OPTIONS')return res.sendStatus(204);next()});
app.get('/',(q,r)=>r.json({ok:1,name:'Seello API'}));
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8')),wr=(f,d)=>fs.writeFileSync(f,JSON.stringify(d,null,2));
const hash=(p,s=crypto.randomBytes(8).toString('hex'))=>s+':'+crypto.scryptSync(p,s,32).toString('hex');
const same=(p,h)=>hash(p,h.split(':')[0])===h;
if(!fs.existsSync('database.json'))wr('database.json',{users:[{username:'Arya',password:hash('Arya'),role:'owner'}],panels:[],messages:[{id:1,room:'global',system:true,text:'Selamat datang di Seello',at:Date.now()}]});
if(!fs.existsSync('api.json'))wr('api.json',{servers:[]});
{const a=rd('api.json');if(!a.servers){wr('api.json',{servers:a.domain?[{id:'s1',name:'Server 1',domain:a.domain,plta:a.plta,pltc:a.pltc,location:a.location||1}]:[]})}}
const getSv=id=>{const v=rd('api.json').servers.find(x=>x.id===id);if(!v)throw new Error('Server tidak ditemukan');return v};
const BUSY='Server sedang sibuk, pakai server lain yang bisa';
const sess=new Map();
const auth=(req,res,next)=>{const u=sess.get((req.headers.authorization||'').slice(7));
 const me=u&&rd('database.json').users.find(x=>x.username===u);
 if(!me)return res.status(401).json({error:'Login dulu'});req.user=me;next()};
const only=(...r)=>(req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({error:'Akses ditolak'});
const wrap=fn=>async(req,res)=>{try{res.json(await fn(req))}catch(e){res.status(400).json({error:e.message})}};
async function pt(sv,path,method='GET',body,client){
 const key=client?sv.pltc:sv.plta;if(!sv.domain||!key)throw new Error(BUSY);
 let r;try{r=await fetch(sv.domain.replace(/\/$/,'')+(client?'/api/client':'/api/application')+path,{method,signal:AbortSignal.timeout(10000),
  headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json'},body:body&&JSON.stringify(body)})}catch{throw new Error(BUSY)}
 const j=await r.json().catch(()=>({}));
 if(r.status===401||r.status===403||r.status>=500)throw new Error(BUSY);
 if(!r.ok)throw new Error(j.errors?.[0]?.detail||'API error '+r.status);return j}
const checkSv=async sv=>{await pt(sv,'/users?per_page=1');await pt(sv,'','GET',null,true)};
const nextId=db=>((db.messages||[]).at(-1)?.id||0)+1;
const valid=/^[a-z0-9_]{3,20}$/i;
app.post('/api/register',wrap(req=>{const{username,password}=req.body,db=rd('database.json');
 if(!valid.test(username||''))throw new Error('Username 3-20 huruf/angka/_');
 if(!password||password.length<4)throw new Error('Password min 4 karakter');
 if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))throw new Error('Username sudah dipakai');
 db.users.push({username,password:hash(password),role:'user'});db.messages=db.messages||[];db.messages.push({id:nextId(db),room:'global',system:true,text:username+' bergabung dengan Seello',at:Date.now()});wr('database.json',db);return{ok:1}}));
app.post('/api/login',wrap(req=>{const{username,password}=req.body,u=rd('database.json').users.find(x=>x.username===username);
 if(!u||!same(password||'',u.password))throw new Error('Username/password salah');
 const t=crypto.randomBytes(24).toString('hex');sess.set(t,u.username);return{token:t,username:u.username,role:u.role}}));
const pub=u=>({username:u.username,role:u.role,name:u.name||u.username,bio:u.bio||''});
app.get('/api/me',auth,wrap(r=>pub(r.user)));
app.post('/api/profile',auth,wrap(req=>{const{name,bio}=req.body,db=rd('database.json'),u=db.users.find(x=>x.username===req.user.username);
 if(name!==undefined)u.name=String(name).trim().slice(0,30);
 if(bio!==undefined)u.bio=String(bio).trim().slice(0,160);
 wr('database.json',db);return pub(u)}));
app.get('/api/servers',auth,wrap(()=>rd('api.json').servers.map(v=>({id:v.id,name:v.name}))));
app.post('/api/check',auth,wrap(async r=>{await checkSv(getSv(r.body.id));return{ok:1}}));
const allEggs=async sv=>{const j=await pt(sv,'/nests?include=eggs');
 return j.data.flatMap(n=>n.attributes.relationships.eggs.data.map(e=>({id:n.attributes.id+':'+e.attributes.id,name:n.attributes.name+' - '+e.attributes.name})))};
app.get('/api/eggs',auth,wrap(async r=>{const sv=getSv(r.query.server);return sv.eggs&&sv.eggs.length?sv.eggs:allEggs(sv)}));
app.get('/api/eggs/all',auth,only('owner'),wrap(r=>allEggs(getSv(r.query.server))));
app.post('/api/create',auth,wrap(async req=>{
 const{name,password,ram,cpu,egg,adp,server}=req.body,sv=getSv(server);
 if(!valid.test(name||''))throw new Error('Nama panel 3-20 huruf/angka/_');
 if(!password||password.length<6)throw new Error('Password panel min 6 karakter');
 if(adp&&req.user.role==='user')throw new Error('Admin Panel hanya untuk admin dan owner');
 if(adp){await checkSv(sv);
  const u=await pt(sv,'/users','POST',{email:name.toLowerCase()+'@panel.com',username:name,first_name:name,last_name:'User',password,root_admin:true});
  const db=rd('database.json');db.panels.push({sid:sv.id,uid:u.attributes.id,server:sv.name,owner:req.user.username,name,adp:true,at:Date.now()});wr('database.json',db);
  return{domain:sv.domain,username:name,password}}
 const gb=Number(ram);if(!(gb>=0&&gb<=100))throw new Error('RAM tidak valid');
 if(sv.eggs?.length&&!sv.eggs.some(x=>x.id===egg))throw new Error('Egg tidak tersedia');
 await checkSv(sv);const[n,e]=String(egg).split(':');
 const eg=(await pt(sv,`/nests/${n}/eggs/${e}?include=variables`)).attributes,env={};
 eg.relationships.variables.data.forEach(v=>env[v.attributes.env_variable]=v.attributes.default_value);
 const u=await pt(sv,'/users','POST',{email:name.toLowerCase()+'@panel.com',username:name,first_name:name,last_name:'User',password,root_admin:!!adp});
 const mem=gb*1024;
 const sr=await pt(sv,'/servers','POST',{name,user:u.attributes.id,egg:+e,docker_image:eg.docker_image,startup:eg.startup,environment:env,
  limits:{memory:mem,swap:0,disk:mem,io:500,cpu:Number(cpu)||0},feature_limits:{databases:1,backups:1,allocations:1},
  deploy:{locations:[+sv.location||1],dedicated_ip:false,port_range:[]}}).catch(async x=>{await pt(sv,'/users/'+u.attributes.id,'DELETE').catch(()=>{});throw x});
 const db=rd('database.json');db.panels.push({sid:sv.id,pid:sr.attributes.id,uid:u.attributes.id,server:sv.name,owner:req.user.username,name,ram:gb,cpu:Number(cpu)||0,adp:!!adp,egg,at:Date.now()});wr('database.json',db);
 return{domain:sv.domain,username:name,password}}));
app.get('/api/panels',auth,wrap(r=>{const sv=rd('api.json').servers;return rd('database.json').panels.filter(p=>p.owner===r.user.username).reverse().map(p=>({...p,domain:(sv.find(x=>x.id===p.sid)||{}).domain||''}))}));
const mine=(req,rec)=>{if(!rec)throw new Error('Panel tidak ditemukan');if(rec.owner!==req.user.username)throw new Error('Akses ditolak')};
const findRec=(db,b)=>b.pid?db.panels.find(p=>p.pid==b.pid):db.panels.find(p=>!p.pid&&p.uid==b.uid);
app.post('/api/panel/edit',auth,wrap(async req=>{const{ram,cpu,password}=req.body,db=rd('database.json'),rec=findRec(db,req.body);mine(req,rec);
 const sv=getSv(rec.sid),np=String(password||'');
 if(np&&np.length<6)throw new Error('Password min 6 karakter');
 if(rec.pid){const gb=Number(ram);if(!(gb>=0&&gb<=100))throw new Error('RAM tidak valid');
  const cur=(await pt(sv,'/servers/'+rec.pid)).attributes,mem=gb*1024;
  await pt(sv,`/servers/${rec.pid}/build`,'PATCH',{allocation:cur.allocation,memory:mem,swap:0,disk:mem,io:500,cpu:Number(cpu)||0,threads:null,feature_limits:cur.feature_limits});
  rec.ram=gb;rec.cpu=Number(cpu)||0}
 if(np){if(!rec.uid)throw new Error('Akun tidak ditemukan');
  await pt(sv,'/users/'+rec.uid,'PATCH',{email:rec.name.toLowerCase()+'@panel.com',username:rec.name,first_name:rec.name,last_name:'User',language:'en',password:np,root_admin:!!rec.adp})}
 wr('database.json',db);return{ok:1}}));
app.post('/api/panel/delete',auth,wrap(async req=>{const db=rd('database.json'),rec=findRec(db,req.body);mine(req,rec);
 const sv=getSv(rec.sid);
 if(rec.pid){await pt(sv,'/servers/'+rec.pid,'DELETE');if(rec.uid)await pt(sv,'/users/'+rec.uid,'DELETE').catch(()=>{})}
 else if(rec.uid)await pt(sv,'/users/'+rec.uid,'DELETE');
 db.panels=db.panels.filter(p=>p!==rec);wr('database.json',db);return{ok:1}}));
const mask=k=>k?'••••'+k.slice(-4):'';
app.get('/api/settings',auth,only('owner'),wrap(()=>rd('api.json').servers.map(v=>({...v,plta:mask(v.plta),pltc:mask(v.pltc)}))));
app.post('/api/settings',auth,only('owner'),wrap(req=>{const a=rd('api.json'),b=req.body;
 if(b.del){a.servers=a.servers.filter(v=>v.id!==b.del);wr('api.json',a);return{ok:1}}
 let v=a.servers.find(x=>x.id===b.id);
 if(!v){v={id:'s'+Date.now(),name:'',domain:'',plta:'',pltc:'',location:1};a.servers.push(v)}
 if(b.name)v.name=b.name.trim();if(b.domain!==undefined)v.domain=b.domain.trim();if(b.location)v.location=+b.location;
 if(b.plta&&!b.plta.startsWith('••'))v.plta=b.plta.trim();if(b.pltc&&!b.pltc.startsWith('••'))v.pltc=b.pltc.trim();
 if(Array.isArray(b.eggs))v.eggs=b.eggs.filter(x=>x&&/^\d+:\d+$/.test(x.id)).map(x=>({id:x.id,name:String(x.name||'Egg').slice(0,40)}));
 if(!v.name)throw new Error('Nama server wajib');wr('api.json',a);return{ok:1}}));
app.get('/api/users',auth,only('owner'),wrap(req=>{const q=String(req.query.q||'').toLowerCase().trim();
 return rd('database.json').users.filter(u=>!q||u.username.toLowerCase().includes(q)||(u.name||'').toLowerCase().includes(q)).slice(0,30).map(u=>({username:u.username,name:u.name||u.username,role:u.role}))}));
app.post('/api/role',auth,only('owner'),wrap(req=>{const{username,role}=req.body,db=rd('database.json');
 if(!['user','admin','owner'].includes(role))throw new Error('Role salah');
 const u=db.users.find(x=>x.username===username);if(!u)throw new Error('User tidak ada');
 if(u.username===req.user.username&&role!=='owner')throw new Error('Tidak bisa menurunkan diri sendiri');
 u.role=role;wr('database.json',db);return{ok:1}}));
// ---- chat ----
const dn=(db,u)=>{const x=db.users.find(y=>y.username===u);return x?(x.name||x.username):u};
const dmKey=(a,b)=>'dm:'+[a,b].map(x=>x.toLowerCase()).sort().join('|');
function resolveRoom(req,db,b){if(!b.with)return{room:'global'};
 const o=db.users.find(x=>x.username.toLowerCase()===String(b.with).toLowerCase());
 if(!o||o.username===req.user.username)throw new Error('Pengguna tidak ditemukan');
 return{room:dmKey(req.user.username,o.username),peer:o}}
app.get('/api/users/search',auth,wrap(req=>{const q=String(req.query.q||'').toLowerCase().trim();if(!q)return[];
 return rd('database.json').users.filter(u=>u.username.toLowerCase().includes(q)&&u.username!==req.user.username).slice(0,10).map(u=>({username:u.username,name:u.name||u.username}))}));
app.get('/api/chats',auth,wrap(req=>{const db=rd('database.json'),M=db.messages||[],me=req.user.username.toLowerCase();
 const last=r=>{const l=M.filter(m=>m.room===r).pop();return l?{text:l.text,at:l.at,from:l.from||'',name:l.from?dn(db,l.from):'',system:!!l.system}:{}};
 const rooms=[...new Set(M.filter(m=>m.room.startsWith('dm:')&&m.room.slice(3).split('|').includes(me)).map(m=>m.room))];
 const dms=rooms.map(r=>{const o=r.slice(3).split('|').find(x=>x!==me),u=db.users.find(x=>x.username.toLowerCase()===o);return u&&{username:u.username,name:u.name||u.username,...last(r)}}).filter(Boolean).sort((a,b)=>b.at-a.at);
 return{global:last('global'),dms}}));
app.get('/api/messages',auth,wrap(req=>{const db=rd('database.json'),{room,peer}=resolveRoom(req,db,req.query),after=+req.query.after||0;
 const list=(db.messages||[]).filter(m=>m.room===room&&m.id>after).slice(-100);
 return{title:peer?(peer.name||peer.username):'Global',messages:list.map(m=>({id:m.id,name:m.from?dn(db,m.from):'',text:m.text,system:!!m.system,at:m.at,me:m.from===req.user.username}))}}));
app.post('/api/messages',auth,wrap(req=>{const db=rd('database.json'),{room}=resolveRoom(req,db,req.body),text=String(req.body.text||'').trim().slice(0,500);
 if(!text)throw new Error('Pesan kosong');db.messages=db.messages||[];
 db.messages.push({id:nextId(db),room,from:req.user.username,text,at:Date.now()});if(db.messages.length>3000)db.messages=db.messages.slice(-3000);
 wr('database.json',db);return{ok:1}}));
const PORT=process.env.SERVER_PORT||process.env.PORT||2033;app.listen(PORT,'0.0.0.0',()=>console.log('Jalan di port '+PORT));
