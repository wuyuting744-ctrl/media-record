/* Account storage uses RLS and optimistic revisions; legacy local data is import-only. */
window.MediaAccount = (() => {
 const cfg=window.MEDIA_SUPABASE_CONFIG;
 const client=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{storageKey:'media-account-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const defaultLayout=[...document.querySelectorAll('#dashGrid .grid-stack-item')].map(el=>({id:el.id,x:0,y:0,w:Number(el.getAttribute('gs-w')),h:Number(el.getAttribute('gs-h'))}));
 let user=null,revision=0,savedLayout=[],ready=false,busy=false,mode='login',epoch=0,lastGood=null,legacyImages={},coverURLs={},coverExpiry={},refreshFlight=null;
 const strip=document.getElementById('accountState');
 const clone=x=>JSON.parse(JSON.stringify(x));
 // Optional per-account cache. Cloud revision still gates all writes.
 let cacheDB;
 function openCache(){
  if(!cacheDB)cacheDB=new Promise((resolve,reject)=>{
   const request=indexedDB.open('muye-account-cache-v1',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('accounts');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
   request.onblocked=()=>reject(Error('Account cache unavailable'));
  });
  return cacheDB;
 }
 async function readCache(id){
  try{return await Promise.race([openCache().then(db=>new Promise((resolve,reject)=>{
   const request=db.transaction('accounts').objectStore('accounts').get(id);
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  })),new Promise(resolve=>setTimeout(()=>resolve(null),250))]);}catch{return null;}
 }
 async function writeCache(data){
  const id=user?.id,token=epoch;if(!id)return;
  const value={userId:id,format:1,row:{...clone(data),revision},covers:{...coverURLs},expires:{...coverExpiry}};
  try{const db=await openCache();if(token!==epoch||user?.id!==id)return;
   await new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(value,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  }catch{/* Cache failure must never fail an account save. */}
 }
 async function deleteCache(id){
  if(!id)return;try{const db=await openCache();await new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').delete(id);tx.oncomplete=resolve;tx.onerror=reject;});}catch{}
 }
 const snapshot=()=>{
  const images={...legacyImages};
  for(const record of records)if(!record.coverPath && !record.coverImg?.startsWith('data:') && imgCache[record.id])images[record.id]=imgCache[record.id];
  // New covers live with their record; leave the existing legacy image map intact.
  for(const record of records)if(record.coverImg?.startsWith('data:')){
   if(Object.prototype.hasOwnProperty.call(legacyImages,record.id))images[record.id]=legacyImages[record.id];
   else delete images[record.id];
  }
  return {records:clone(records),images,genres:[...customGenres],companions:[...customCompanions],layout:clone(savedLayout)};
 };
 const restore=data=>{legacyImages={...(data.images||{})};records=data.records||[];imgCache={...(data.images||{})};for(const record of records){if(record.coverImg?.startsWith('data:'))imgCache[record.id]=record.coverImg;else if(record.coverPath)imgCache[record.id]=coverURLs[record.coverPath]||'';else if(!record.coverImg)delete imgCache[record.id];}customGenres=data.genres||[];customCompanions=data.companions||[];savedLayout=data.layout||[];};
 async function loadCoverURLs(data){
  const paths=[...new Set((data.records||[]).map(r=>r.coverPath).filter(Boolean))];
  const map={},missing=[];
  for(const path of paths){
   if(coverURLs[path]?.startsWith('data:') || coverExpiry[path]>Date.now()+60000)map[path]=coverURLs[path];
   else missing.push(path);
  }
  if(!missing.length)return map;
  const urls=await result(client.storage.from('media-covers').createSignedUrls(missing,604800));
  for(const item of urls||[])if(item.signedUrl){map[item.path]=item.signedUrl;coverExpiry[item.path]=Date.now()+604800000;}
  return map;
 }
 async function uploadChangedCovers(next){
  const before=new Map((lastGood?.records||[]).map(r=>[r.id,r]));
  for(const record of next.records){
   if(JSON.stringify(record)===JSON.stringify(before.get(record.id)))continue;
   const previous=before.get(record.id);
   const image=record.coverImg;
   // A signed URL belongs to an already uploaded cover; keep its permanent path.
   if(image && previous?.coverPath && image===imgCache[record.id] && !image.startsWith('data:')){record.coverImg='__storage__';continue;}
   if(!image){delete record.coverPath;continue;}
   if(!image.startsWith('data:'))continue;
   if(previous?.coverPath && image===coverURLs[previous.coverPath]){record.coverImg='__storage__';continue;}
   status('正在上传新封面…');
   const blob=await (await fetch(image)).blob();
   if(blob.size>2097152)throw Error('封面超过2MB，请重新选择图片以压缩');
   const extension=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
   const path=user.id+'/'+record.id+'/'+crypto.randomUUID()+'.'+extension;
   await result(client.storage.from('media-covers').upload(path,blob,{contentType:blob.type,upsert:false,cacheControl:'31536000'}));
   record.coverImg='__storage__';record.coverPath=path;coverURLs[path]=image;
  }
 }
 const errorText=e=>/Invalid login credentials/i.test(e.message)?'邮箱或密码不正确':/Email not confirmed/i.test(e.message)?'请先验证邮箱，再登录':/media_save_delta|Bucket not found/i.test(e.message)?'云端提速配置尚未启用，请执行 incremental-save.sql':/schema cache|does not exist/i.test(e.message)?'云端资料表尚未初始化':e.message||'网络连接失败，请重试';
 const result=async promise=>{const r=await promise;if(r.error)throw r.error;return r.data;};
 const render=()=>{renderStats();renderCompanionFilter();populateGenreFilter();applyFilters();if(currentView==='dashboard')renderDashboard();};
 const status=text=>{strip.textContent=text;const connection=document.getElementById('sidebarConnection');if(connection)connection.textContent=!user?'点击登录':/^已同步|^已保存/.test(text)?'云端已连结':/失败|冲突/.test(text)?'连结异常，请重试':/^正在保存|^正在上传/.test(text)?'正在保存…':'正在连结…';};
 document.body.insertAdjacentHTML('beforeend',`<div class="modal-backdrop" id="accountModal"><div class="modal account-modal" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><div class="modal-header"><h2 id="accountTitle">登录你的档案</h2><button class="btn btn-secondary" onclick="hideModal('accountModal')" aria-label="关闭">×</button></div><div class="account-body"><p id="accountHint">让故事与记录，跟随你到每一台设备。</p><form id="accountForm"><label for="accountEmail">邮箱</label><input id="accountEmail" type="email" required autocomplete="email" class="form-control"><label for="accountPassword">密码</label><input id="accountPassword" type="password" minlength="8" required autocomplete="current-password" class="form-control"><p id="accountError" role="status" aria-live="polite"></p><button class="btn btn-primary" id="accountSubmit" type="submit">登录</button></form><div id="accountLinks"><button class="btn btn-secondary" onclick="MediaAccount.mode('signup')">注册账号</button><button class="btn btn-secondary" onclick="MediaAccount.mode('reset')">忘记密码</button><button class="btn btn-secondary" onclick="MediaAccount.mode('login')">返回登录</button></div><div id="accountSigned" hidden><p id="accountIdentity"></p><button class="btn btn-secondary" onclick="MediaAccount.logout()">退出登录</button></div></div></div></div>`);
 const setMode=value=>{mode=value;const names={login:'登录',signup:'注册',reset:'发送重置邮件',password:'保存新密码'};document.getElementById('accountTitle').textContent=value==='login'?'登录你的档案':names[value];document.getElementById('accountSubmit').textContent=names[value];document.getElementById('accountPassword').required=!['reset'].includes(value);document.getElementById('accountPassword').hidden=value==='reset';document.getElementById('accountPassword').autocomplete=value==='login'?'current-password':'new-password';document.getElementById('accountEmail').required=value!=='password';document.getElementById('accountEmail').hidden=value==='password';document.getElementById('accountError').textContent='';document.getElementById('accountForm').hidden=!!user&&value!=='password';document.getElementById('accountSigned').hidden=!user||value==='password';document.getElementById('accountLinks').hidden=!!user;};
 function refresh(){
  if(busy)return Promise.resolve();
  if(refreshFlight)return refreshFlight;
  const flight=refreshNow();refreshFlight=flight;
  flight.finally(()=>{if(refreshFlight===flight)refreshFlight=null;});
  return flight;
 }
 async function refreshNow(){
  const token=++epoch;ready=false;switchView('grid');clearFilters();
  try{
   const session=await result(client.auth.getSession());if(token!==epoch)return;
   user=session.session?.user||null;coverURLs={};coverExpiry={};lastGood=null;restore({});render();
   document.querySelectorAll('.modal-backdrop.open').forEach(el=>hideModal(el.id));if(manageMode)exitManage();
   document.getElementById('sidebarUsername').textContent=user?(user.user_metadata?.display_name||user.user_metadata?.name||user.email.split('@')[0]):'未登录';
   document.getElementById('sidebarConnection').textContent=user?'正在连结…':'点击登录';
   document.getElementById('accountIdentity').textContent=user?.email||'';
   if(!user){status('登录后，记录与封面将保存到你的私人账号。');document.getElementById('importLocal').hidden=true;return;}
   const cached=await readCache(user.id);if(token!==epoch)return;
   let row;
   if(cached?.format===1 && cached.userId===user.id && Array.isArray(cached.row?.records) && Number.isFinite(cached.row.revision)){
    coverURLs=cached.covers||{};coverExpiry=cached.expires||{};
    // Expired signed URLs must not be shown while refreshing the cache.
    for(const path of Object.keys(coverURLs))if(!coverURLs[path].startsWith('data:') && !(coverExpiry[path]>Date.now()+60000))delete coverURLs[path];
    restore(clone(cached.row));render();status('已显示本机缓存，正在核对云端…');
    const header=await result(client.from('media_account_data').select('revision,updated_at').eq('user_id',user.id).maybeSingle());
    if(token!==epoch)return;
    if(header && header.revision===cached.row.revision)row=clone(cached.row);
   }
   if(!row){
    status('正在读取云端资料…');
    row=await result(client.from('media_account_data').select('*').eq('user_id',user.id).maybeSingle());
    if(!row){await result(client.from('media_account_data').upsert({user_id:user.id},{onConflict:'user_id',ignoreDuplicates:true}));row=await result(client.from('media_account_data').select('*').eq('user_id',user.id).single());}
   }
   if(token!==epoch)return;
   const urls=await loadCoverURLs(row);if(token!==epoch)return;
   coverURLs=urls;restore(row);revision=row.revision;lastGood=snapshot();render();
   status('已同步 · '+user.email);document.getElementById('importLocal').hidden=!localStorage.getItem(STORAGE_KEY);
   if(dashGrid){dashGrid.load(clone(savedLayout.length?savedLayout:defaultLayout));resetDashLayoutBaseline();}
   ready=true;void writeCache(lastGood);
  }catch(e){if(token!==epoch)return;status('同步失败 · '+errorText(e));showToast(errorText(e),'error');}
 }

 function guard(){if(!user||!ready){open();throw Error('请先登录并完成资料同步');}if(busy)throw Error('正在保存，请稍候');}
 async function persist(){
  guard();busy=true;const token=epoch;status('正在保存到账号…');
  try{
   const next=snapshot(),patch={};
   await uploadChangedCovers(next);
   const previous=new Map((lastGood?.records||[]).map(r=>[r.id,r]));
   const ids=new Set(next.records.map(r=>r.id));
   const upsert=next.records.filter(r=>JSON.stringify(r)!==JSON.stringify(previous.get(r.id)));
   const deleted=[...previous.keys()].filter(id=>!ids.has(id));
   if(upsert.length)patch.upsert=upsert;
   if(deleted.length)patch.deleted=deleted;
   const oldIds=(lastGood?.records||[]).map(r=>r.id).filter(id=>ids.has(id));
   const existingIds=next.records.filter(r=>previous.has(r.id)).map(r=>r.id);
   if(JSON.stringify(oldIds)!==JSON.stringify(existingIds) || upsert.filter(r=>!previous.has(r.id)).length>1)patch.order=next.records.map(r=>r.id);
   for(const field of ['genres','companions','layout']){
    if(JSON.stringify(next[field])!==JSON.stringify(lastGood?.[field]))patch[field]=next[field];
   }
   const changedImages={};for(const [id,image] of Object.entries(next.images))if(image!==lastGood?.images?.[id])changedImages[id]=image;
   if(Object.keys(changedImages).length)patch.images=changedImages;
   const deletedImages=Object.keys(lastGood?.images||{}).filter(id=>!Object.hasOwn(next.images,id));
   if(deletedImages.length)patch.deletedImages=deletedImages;
   if(!Object.keys(patch).length){status('已保存 · '+user.email);return;}
   if(new Blob([JSON.stringify(patch)]).size>25000000)throw Error('保存请求超过25MB，请缩减封面图片');
   const saved=await result(client.rpc('media_save_delta',{p_revision:revision,p_changes:patch}).maybeSingle());
   if(!saved)throw Error('版本冲突，请刷新云端资料后重试');
   if(token!==epoch)return;
   revision=saved.revision;records=next.records;legacyImages={...next.images};lastGood=clone(next);status('已保存 · '+user.email);void writeCache(lastGood);
  }catch(e){if(token===epoch){if(lastGood)restore(clone(lastGood));render();status('保存失败 · '+errorText(e));}throw e;}
  finally{busy=false;}
 }

 function open(){setMode('login');showModal('accountModal');setTimeout(()=>document.getElementById('accountEmail').focus(),80);}
 const redirect=()=>location.origin+location.pathname;
 document.getElementById('accountForm').addEventListener('submit',async e=>{e.preventDefault();const btn=document.getElementById('accountSubmit');btn.disabled=true;const email=document.getElementById('accountEmail').value.trim(),password=document.getElementById('accountPassword').value;try{if(mode==='signup'){await result(client.auth.signUp({email,password,options:{emailRedirectTo:redirect()}}));document.getElementById('accountError').textContent='请查看验证邮件，验证后返回登录。';}else if(mode==='reset'){await result(client.auth.resetPasswordForEmail(email,{redirectTo:redirect()}));document.getElementById('accountError').textContent='若账号存在，重置邮件将发送至该邮箱。';}else if(mode==='password'){await result(client.auth.updateUser({password}));hideModal('accountModal');showToast('密码已更新');}else{await result(client.auth.signInWithPassword({email,password}));await refresh();if(ready)hideModal('accountModal');}}catch(err){document.getElementById('accountError').textContent=errorText(err);}finally{btn.disabled=false;document.getElementById('accountPassword').value='';}});
 async function logout(){if(busy)return showToast('请等待保存完成');const id=user?.id;await result(client.auth.signOut({scope:'local'}));await refresh();await deleteCache(id);hideModal('accountModal');}
 async function importFile(file){try{guard();const data=JSON.parse(await file.text());if(data.format!=='muye-backup'||!Array.isArray(data.records)||!data.images||typeof data.images!=='object')throw Error('备份格式不正确');if(data.records.some(r=>!r.id||!r.title))throw Error('备份记录不完整');if(!confirm('将备份中的 '+data.records.length+' 条记录导入 '+user.email+'？已有记录将保留。'))return;const ids=new Set(records.map(r=>r.id));const added=data.records.filter(r=>!ids.has(r.id));records.push(...added);for(const r of added)if(data.images[r.id])imgCache[r.id]=data.images[r.id];customGenres=[...new Set([...customGenres,...(data.genres||[])])];customCompanions=[...new Set([...customCompanions,...(data.companions||[])])];if(!savedLayout.length)savedLayout=data.layout||[];await persist();render();showToast('已导入 '+added.length+' 条记录，共 '+records.length+' 条','success');}catch(e){showToast(errorText(e),'error');}}
 document.getElementById('accountStrip').insertAdjacentHTML('beforeend','<label class="btn btn-secondary" style="font-size:11px;cursor:pointer">导入备份文件<input id="backupFile" type="file" accept=".json,application/json" hidden></label>');document.getElementById('backupFile').addEventListener('change',e=>{const file=e.target.files[0];if(file)importFile(file);e.target.value='';});
 async function importLocal(){try{guard();if(!confirm('将本机旧记录、封面与标签导入当前账号？现有账号记录会保留。'))return;const cloudImages={...imgCache};await loadImagesFromIDB();const old=loadRecords();imgCache={...imgCache,...cloudImages};const ids=new Set(records.map(r=>r.id));records.push(...old.filter(r=>!ids.has(r.id)));customGenres=[...new Set([...customGenres,...JSON.parse(localStorage.getItem(CUSTOM_GENRES_KEY)||'[]')])];customCompanions=[...new Set([...customCompanions,...JSON.parse(localStorage.getItem(CUSTOM_COMPANIONS_KEY)||'[]')])];await persist();render();showToast('本机记录已导入账号');}catch(e){showToast(errorText(e),'error');}}
 client.auth.onAuthStateChange((event,session)=>setTimeout(()=>{if(event==='PASSWORD_RECOVERY'){user=session.user;setMode('password');showModal('accountModal');}else if((event==='SIGNED_OUT'&&user!==null)||(event==='SIGNED_IN'&&session?.user.id!==user?.id)){const oldId=user?.id;if(event==='SIGNED_OUT'){void deleteCache(oldId);ready=false;user=null;restore({});render();}epoch++;refreshFlight=null;refresh();}},0));
 return {open,mode:setMode,refresh,logout,importLocal,guard,persist,layout:()=>savedLayout,saveLayout:async items=>{guard();savedLayout=clone(items);await persist();},resetLayout:async()=>{guard();if(dashGrid)dashGrid.load(clone(defaultLayout));} ,start:async()=>{await init();await refresh();}};
})();
// Keep every original interaction; commit data before closing its form or showing success.
saveImageToIDB=(id,image)=>{imgCache[id]=image;};
deleteImageFromIDB=id=>{delete imgCache[id];};
saveRecords=()=>{};
for(const name of ['confirmDelete','deleteSelected','onDrop']){
 const original=window[name];
 window[name]=async function(...args){
  if(name==='saveRecord')args[0]?.preventDefault();
  try{MediaAccount.guard();}catch(e){showToast(e.message,'error');return;}
  const toast=showToast,close=closeFormModal,confirmClose=closeConfirmModal;
  const messages=[];showToast=(...m)=>messages.push(m);closeFormModal=()=>{};closeConfirmModal=()=>{};
  try{original(...args);}finally{showToast=toast;closeFormModal=close;closeConfirmModal=confirmClose;}
  const submit=document.querySelector('#recordForm button[type="submit"]');
  if(name==='saveRecord'&&submit)submit.disabled=true;
  try{await MediaAccount.persist();if(name==='saveRecord'){close();document.getElementById('formModal').classList.remove('visible','open');}if(name==='confirmDelete')confirmClose();messages.forEach(m=>toast(...m));}catch(e){toast(e.message,'error');}finally{if(submit)submit.disabled=false;}
 };
}
for(const name of ['openAddModal','openEditModal','enterManage']){const original=window[name];window[name]=(...args)=>{try{MediaAccount.guard();original(...args);}catch(e){showToast(e.message,'error');}};}
MediaAccount.start();
