const {chromium}=require('playwright');const assert=require('assert');
(async()=>{
const b=await chromium.launch({channel:'msedge'});const p=await b.newPage();let uid='a',full=0,headers=0,signs=0,failHeader=false,delayHeader=0;
let row={records:[{id:'old',title:'旧记录',category:'电影',status:'看过',coverImg:'__idb__'},{id:'cloud',title:'云端封面',category:'电影',status:'看过',coverImg:'__storage__',coverPath:'a/cloud/cover.jpg'}],images:{old:'data:image/jpeg;base64,'+'A'.repeat(1000000)},genres:[],companions:[],layout:[],revision:1};
const session=()=>({access_token:'test',refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:uid,email:uid+'@example.com',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}});
await p.route('**/*.supabase.co/**',async route=>{const req=route.request(),url=req.url();
if(url.includes('/token'))return route.fulfill({json:session()});if(url.includes('/logout'))return route.fulfill({json:{}});if(url.includes('/user'))return route.fulfill({json:session().user});
if(url.includes('/storage/v1/object/sign')&&req.method()==='POST'){signs++;return route.fulfill({json:req.postDataJSON().paths.map(path=>({path,signedURL:'/object/sign/media-covers/'+path+'?token=test'}))});}
if(url.includes('/storage/'))return route.fulfill({status:404,body:''});
if(url.includes('select=revision')){headers++;if(delayHeader)await new Promise(r=>setTimeout(r,delayHeader));if(failHeader)return route.fulfill({status:503,json:{message:'网络错误'}});return route.fulfill({json:{revision:row.revision,updated_at:new Date().toISOString()}});}
full++;return route.fulfill({json:row});});
await p.goto(require('url').pathToFileURL(require('path').join(__dirname,'index.html')).href);await p.click('#accountButton');await p.fill('#accountEmail','a@example.com');await p.fill('#accountPassword','password123');await p.click('#accountSubmit');await p.waitForFunction(()=>document.getElementById('accountState').textContent.startsWith('已同步'));
assert.equal(full,1);assert.equal(signs,1);
// Reload displays cache before the deliberately delayed cloud revision response.
delayHeader=1000;await p.reload();await p.waitForFunction(()=>document.getElementById('accountState').textContent.includes('核对云端'));
assert.equal(await p.evaluate(()=>records.length),2);assert.equal(await p.evaluate(()=>{try{MediaAccount.guard();return true;}catch{return false;}}),false);
await p.waitForFunction(()=>document.getElementById('accountState').textContent.startsWith('已同步'));assert.equal(full,1);assert.equal(signs,1);assert.equal(headers,1);delayHeader=0;
const h=headers;await p.evaluate(()=>Promise.all([MediaAccount.refresh(),MediaAccount.refresh(),MediaAccount.refresh()]));assert.equal(headers,h+1);assert.equal(full,1);
// A changed cloud revision fetches the full row and replaces stale cache.
row={...row,revision:2,records:[...row.records,{id:'remote',title:'另一台设备新增',category:'小说',status:'看过'}]};await p.evaluate(()=>MediaAccount.refresh());assert.equal(full,2);assert.equal(await p.evaluate(()=>records.length),3);
// Failed version check retains read-only cached view and prohibits editing.
failHeader=true;await p.evaluate(()=>MediaAccount.refresh());assert.equal(await p.evaluate(()=>records.length),3);assert.equal(await p.evaluate(()=>{try{MediaAccount.guard();return true;}catch{return false;}}),false);failHeader=false;
await p.evaluate(()=>MediaAccount.refresh());await p.evaluate(()=>MediaAccount.logout());assert.equal(await p.evaluate(()=>records.length),0);
// Logout deletes the previous account's cache.
assert.equal(await p.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('muye-account-cache-v1',1);r.onsuccess=()=>{const q=r.result.transaction('accounts').objectStore('accounts').get('a');q.onsuccess=()=>resolve(!!q.result);};})),false);
uid='b';row={records:[],images:{},genres:[],companions:[],layout:[],revision:0};await p.click('#accountButton');await p.fill('#accountEmail','b@example.com');await p.fill('#accountPassword','password123');await p.click('#accountSubmit');await p.waitForFunction(()=>document.getElementById('accountState').textContent==='已同步 · b@example.com');assert.equal(await p.evaluate(()=>records.length),0);assert.equal(await p.evaluate(()=>Object.keys(imgCache).length),0);
console.log('PASS: first load, cached reload before cloud response, revision-only check, signed URL reuse, coalesced refresh, remote changes, failed-sync write guard, cache deletion, account isolation');await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
