const {chromium}=require('playwright');const assert=require('assert');
(async()=>{
 const browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage();
 page.on('pageerror',e=>console.error('PAGE',e.message));
 let failSave=false,failUpload=false;const requests=[],uploads=[];
 let row={records:Array.from({length:64},(_,i)=>({id:'old'+i,title:'旧记录'+i,category:'电影',status:'看过',coverImg:'__idb__'})),images:Object.fromEntries(Array.from({length:64},(_,i)=>['old'+i,'data:image/jpeg;base64,'+'A'.repeat(80000)])),genres:[],companions:[],layout:[],revision:0};
 const auth=()=>({access_token:'test',refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'a',email:'a@example.com',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}});
 await page.route('**/*.supabase.co/**',async route=>{
  const req=route.request(),url=req.url();
  if(url.includes('/token'))return route.fulfill({json:auth()});
  if(url.includes('/logout'))return route.fulfill({json:{}});
  if(url.includes('/user'))return route.fulfill({json:auth().user});
  if(url.includes('/storage/v1/object/sign/media-covers') && req.method()==='GET')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  if(url.includes('/storage/v1/object/sign/media-covers'))return route.fulfill({json:req.postDataJSON().paths.map(path=>({path,signedURL:'/object/sign/media-covers/'+path+'?token=test'}))});
  if(url.includes('/storage/v1/object/media-covers')){uploads.push(req.postDataBuffer().length);return route.fulfill(failUpload?{status:500,json:{message:'上传失败',error:'upload failed'}}:{json:{Key:'media-covers/test'}});}
  if(url.includes('/rpc/media_save_delta')){
   const body=req.postDataJSON();requests.push(body);if(failSave)return route.fulfill({status:409,json:{message:'版本冲突',code:'P0001'}});
   assert.equal(body.p_revision,row.revision);const d=body.p_changes;
   row.records=row.records.filter(r=>!(d.deleted||[]).includes(r.id));
   for(const record of d.upsert||[]){const index=row.records.findIndex(r=>r.id===record.id);if(index<0)row.records.unshift(record);else row.records[index]=record;}
   if(d.order)row.records.sort((a,b)=>d.order.indexOf(a.id)-d.order.indexOf(b.id));
   Object.assign(row.images,d.images||{});for(const id of d.deletedImages||[])delete row.images[id];
   for(const field of ['genres','companions','layout'])if(field in d)row[field]=d[field];
   row.revision++;return route.fulfill({json:{revision:row.revision,updated_at:new Date().toISOString()}});
  }
  return route.fulfill({json:row});
 });
 await page.goto(require('url').pathToFileURL(require('path').join(__dirname,'index.html')).href);
 await page.click('#accountButton');await page.fill('#accountEmail','a@example.com');await page.fill('#accountPassword','password123');await page.click('#accountSubmit');await page.waitForFunction(()=>records.length===64);
 const submit=async()=>{await page.selectOption('#fCat','电影');await page.locator('#recordForm button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#recordForm button[type="submit"]').disabled);};
 await page.evaluate(()=>openAddModal());await page.fill('#fTitle','新记录');await submit();
 assert.equal(requests[0].p_changes.upsert.length,1);assert(JSON.stringify(requests[0]).length<1500);assert.equal(uploads.length,0);assert.equal(row.records.length,65);
 await page.evaluate(()=>openEditModal('old0'));await page.fill('#fTitle','旧记录换封面');await page.evaluate(()=>currentImgBase64='data:image/jpeg;base64,'+'C'.repeat(12000));await submit();
 assert.equal(uploads.length,1);assert.equal(requests[1].p_changes.upsert.length,1);assert(JSON.stringify(requests[1]).length<1500);assert(!requests[1].p_changes.images);assert(row.records.find(r=>r.id==='old0').coverPath);assert.equal(Object.keys(row.images).length,64);
 await page.evaluate(()=>openEditModal('old0'));await page.fill('#fTitle','只改标题');await submit();assert.equal(uploads.length,1);
 await page.evaluate(()=>MediaAccount.refresh());assert((await page.evaluate(()=>imgCache.old0)).startsWith('data:') || (await page.evaluate(()=>imgCache.old0)).includes('/object/sign/'));
 await page.evaluate(()=>openEditModal('old0'));await page.fill('#fTitle','签名地址编辑');await submit();assert.equal(uploads.length,1);assert.equal(row.records.find(r=>r.id==='old0').coverImg,'__storage__');
 await page.evaluate(()=>openAddModal());await page.fill('#fTitle','新封面');
 const inputImage=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1000;canvas.getContext('2d').fillRect(0,0,1600,1000);return canvas.toDataURL('image/png').split(',')[1];});
 await page.setInputFiles('#imgFileInput',{name:'cover.png',mimeType:'image/png',buffer:Buffer.from(inputImage,'base64')});await page.waitForFunction(()=>currentImgBase64.startsWith('data:image/webp'));
 const imageSize=await page.evaluate(()=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve([image.width,image.height]);image.src=currentImgBase64;}));assert.deepEqual(imageSize,[640,400]);await submit();assert.equal(uploads.length,2);assert(JSON.stringify(requests.at(-1)).length<1500);assert(!requests.at(-1).p_changes.images);
 const newId=row.records[0].id;failSave=true;await page.evaluate(id=>openEditModal(id),newId);await page.fill('#fTitle','失败编辑');await submit();assert.equal(await page.evaluate(()=>records[0].title),'新封面');assert(await page.locator('#formModal').evaluate(e=>e.classList.contains('open')));assert.equal(await page.inputValue('#fTitle'),'失败编辑');failSave=false;
 failUpload=true;await page.evaluate(()=>currentImgBase64='data:image/jpeg;base64,'+'D'.repeat(8000));const requestCount=requests.length;await submit();assert.equal(requests.length,requestCount);assert(await page.locator('#formModal').evaluate(e=>e.classList.contains('open')));failUpload=false;
 await page.evaluate(()=>removeImg());await submit();assert(!row.records[0].coverPath);assert.equal(row.records[0].coverImg,'');
 await page.evaluate(()=>{records.reverse();});await page.evaluate(()=>MediaAccount.persist());assert(requests.at(-1).p_changes.order);assert(!requests.at(-1).p_changes.upsert);
 await page.evaluate(()=>{records=records.filter(r=>r.id!=='old1');});await page.evaluate(()=>MediaAccount.persist());assert.deepEqual(requests.at(-1).p_changes.deleted,['old1']);
 await page.evaluate(()=>MediaAccount.logout());assert.equal(await page.evaluate(()=>records.length),0);assert.equal(await page.evaluate(()=>Object.keys(imgCache).length),0);
 console.log('PASS: 64 legacy records, small single-record requests, private cover upload, unchanged-cover reuse, signed reload, image removal, upload/save failure, ordering, deletion, logout');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
