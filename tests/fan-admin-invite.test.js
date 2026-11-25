const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function section(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return html.slice(a,b)}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function environment(options={}){
  const group={id:'club',name:'江逾白的粉丝群',scene:'群主是江逾白，这里是他的直播粉丝聊天群。',isLiveGroup:true,charIds:['host','fan'],adminIds:['host'],mode:'chat'};
  const data=new Map(),modals=[],alerts=[],toasts=[],requests=[],renders=[],uiUpdates=[];
  const forged={};
  let seq=0,slot='A';
  const ctx=vm.createContext({
    groups:[group],charList:[{id:'host',name:'江逾白',personality:'温柔'},{id:'fan',name:'小鱼',isHidden:true}],
    personaList:[{id:'p',name:'观众'}],activePersonaId:'p',P:()=>({name:'观众'}),
    store:{_realKey:key=>'slot_'+slot+'::'+key,get:(key,fallback)=>data.has(slot+'::'+key)?data.get(slot+'::'+key):fallback,
      set:(key,value)=>data.set(slot+'::'+key,structuredClone(value))},
    saveGroups(){ctx.store.set('groups',ctx.groups)},saveCharList(){ctx.store.set('charList',ctx.charList)},
    getGroupMsgs:id=>ctx.store.get('messages_'+id,[]),saveGroupMsgs:(id,arr)=>ctx.store.set('messages_'+id,arr),
    getApi:()=>({key:'test'}),uid:()=>String(++seq),genWcId:()=>'',worldBooks:[],styleBooks:[],
    isN:()=>false,escHtml:String,avatarEl:()=>'',I:{mirror:()=>''},now:()=>new Date(),ftime:()=>'22:00',
    confirm:()=>true,alert:message=>alerts.push(message),showToast:message=>toasts.push(message),
    render:page=>renders.push(page),updateCharRel(){},_curPage:'groupchat',
    document:{getElementById:id=>id==='_gcmsgs'?{_onGroupInvite:(...args)=>uiUpdates.push(args)}:null},
    askAIJson:async (...args)=>{requests.push(args);return options.pending?options.pending.promise:{name:'新粉丝',firstMsg:'大家好'}},
    showModal(title,build){
      const controls=new Map();
      const body={innerHTML:'',isConnected:true,style:{},querySelector(key){
        if(!controls.has(key))controls.set(key,{style:{},dataset:{},value:'',textContent:'',disabled:false});return controls.get(key)
      },querySelectorAll:selector=>forged[selector]||[]};
      const modal={title,body,controls,close(){body.isConnected=false}};
      modals.push(modal);build(body,modal.close)
    },
    askAI:async()=>'',isLLMError:()=>false,deliverGroupPrivateReaction(){},console,
  });
  ctx.window=ctx;ctx.store.set('activeGroupId','club');
  vm.runInContext(section('// ── 群主判定 ──','// ===== 角色游戏房间 ====='),ctx);
  vm.runInContext(section('function openGroupMenu(g)','// ===== 群聊小游戏'),ctx);
  const open=()=>{ctx.openGroupMenu(group);return modals.at(-1)};
  return {ctx,group,open,data,modals,alerts,toasts,requests,renders,forged,uiUpdates,
    switchSlot(value){slot=value},currentSlot:()=>slot};
}

test('legacy fan group migration restores user moderator without changing streamer ownership',()=>{
  const e=environment();
  e.ctx.normalizeGroupOwners();
  assert.equal(e.group.ownerId,'host');assert.equal(e.group.liveHostId,'host');
  assert.ok(e.group.adminIds.includes('u'));assert.ok(e.group.adminIds.includes('host'));
  assert.equal(e.ctx.canManageGroup(e.group),true);
  assert.match(e.ctx.groupOwnershipPrompt(e.group),/管理员（不是群主）/);
  assert.equal(e.ctx.normalizeGroupOwners(),false,'migration is idempotent');
});

test('user moderator sees fan management controls and can kick ordinary members',()=>{
  const e=environment(),kick={dataset:{id:'fan'}};
  e.forged['._gckick']=[kick];
  const modal=e.open();
  assert.match(modal.body.innerHTML,/你是管理员/);
  assert.match(modal.body.innerHTML,/class="_gckick /);
  kick.onclick();
  assert.deepEqual(e.group.charIds,['host']);assert.equal(e.group.ownerId,'host');
});

test('user moderator can mute and unmute a fan while protecting the streamer',()=>{
  const e=environment(),fanMute={dataset:{id:'fan'}},hostMute={dataset:{id:'host'}},hostKick={dataset:{id:'host'}};
  e.forged['._gcmute']=[fanMute,hostMute];e.forged['._gckick']=[hostKick];
  e.open();fanMute.onclick();assert.deepEqual(Array.from(e.group.mutedIds),['fan']);
  fanMute.onclick();assert.deepEqual(Array.from(e.group.mutedIds),[]);
  hostMute.onclick();hostKick.onclick();assert.ok(e.group.charIds.includes('host'));
  assert.equal(e.group.mutedIds.includes('host'),false);assert.equal(e.group.ownerId,'host');
});

test('closing settings while AI thinks still saves the new fan and announcement',async()=>{
  const pending=deferred(),e=environment({pending});
  const modal=e.open();
  const request=modal.controls.get('#_gcpullnpc').onclick();
  modal.close();pending.resolve({name:'晚来的粉丝',firstMsg:'来了'});
  await request;
  const member=e.ctx.charList.find(c=>c.name==='晚来的粉丝');
  assert.ok(member);assert.ok(e.group.charIds.includes(member.id));
  assert.ok(e.ctx.getGroupMsgs('club').some(m=>m.from===member.id&&m.text==='来了'));
  assert.equal(e.group.adminIds.includes(member.id),false);
  assert.ok(e.toasts.some(text=>text.includes('晚来的粉丝')));
  assert.equal(e.uiUpdates.length,1,'active group receives a new member without losing its draft');
  assert.equal(e.renders.length,0,'a dismissed modal must not force a page rerender');
});

test('reopening settings shares the pending invite and blocks a duplicate AI request',async()=>{
  const pending=deferred(),e=environment({pending}),first=e.open();
  const request=first.controls.get('#_gcpullnpc').onclick();first.close();
  const second=e.open(),button=second.controls.get('#_gcpullnpc');
  assert.equal(button.disabled,true);assert.match(button.textContent,/思考|邀请中/);
  await button.onclick();assert.equal(e.requests.length,1);
  pending.resolve({name:'新粉丝'});await request;
  assert.equal(button.disabled,false);assert.equal(e.group.charIds.length,3);
});

test('navigating away while AI thinks completes the invite without switching pages back',async()=>{
  const pending=deferred(),e=environment({pending}),modal=e.open();
  const request=modal.controls.get('#_gcpullnpc').onclick();modal.close();e.ctx._curPage='live';
  pending.resolve({name:'后台加入的粉丝'});await request;
  assert.ok(e.ctx.charList.some(c=>c.name==='后台加入的粉丝'));
  assert.equal(e.renders.length,0);assert.equal(e.uiUpdates.length,0);
});

for(const invalidate of ['switch save','leave group','delete group'])test(`pending invite is discarded after ${invalidate}`,async()=>{
  const pending=deferred(),e=environment({pending}),modal=e.open();
  const request=modal.controls.get('#_gcpullnpc').onclick();modal.close();
  if(invalidate==='switch save')e.switchSlot('B');
  if(invalidate==='leave group')modal.controls.get('#_gmleave').onclick();
  if(invalidate==='delete group')e.ctx.groups=[];
  pending.resolve({name:'不应加入'});await request;
  assert.equal(e.ctx.charList.some(c=>c.name==='不应加入'),false);
  assert.equal(e.group.charIds.length,2);
  assert.equal(e.ctx.getGroupMsgs('club').length,0);
});

test('invite failure after modal closure is visible and a fresh invite can be retried',async()=>{
  const pending=deferred(),e=environment({pending}),modal=e.open();
  const request=modal.controls.get('#_gcpullnpc').onclick();modal.close();
  pending.reject(new Error('API timeout'));await request;
  assert.ok(e.toasts.some(text=>text.includes('失败')));
  const retry=e.open().controls.get('#_gcpullnpc');assert.equal(retry.disabled,false);
});

test('switching away and back cancels the old invite instead of showing a duplicate pending job',async()=>{
  const pending=deferred(),e=environment({pending}),modal=e.open();
  const request=modal.controls.get('#_gcpullnpc').onclick();modal.close();
  e.ctx.cancelGroupInvitesForSlot('A');e.switchSlot('B');e.switchSlot('A');
  assert.equal(e.ctx.pendingGroupInvite(e.group),null);
  pending.resolve({name:'过期邀请'});await request;
  assert.equal(e.ctx.charList.some(c=>c.name==='过期邀请'),false);
});

test('deleting a save cancels its invitation before asynchronous data cleanup starts',async()=>{
  const pending=deferred(),cleanup=deferred(),e=environment({pending}),modal=e.open();
  const request=modal.controls.get('#_gcpullnpc').onclick();modal.close();
  const meta={list:[{id:'A'},{id:'B'}]};
  e.ctx.getSavesMeta=()=>meta;e.ctx.saveSavesMeta=()=>{};e.ctx._currentSlot='A';
  e.ctx.store.cache={'slot_A::groups':[]};
  e.ctx.store.delRaw=()=>cleanup.promise;e.ctx.switchSlot=async()=>true;
  vm.runInContext(section('async function deleteSlot(','async function renameSlot('),e.ctx);
  const deletion=e.ctx.deleteSlot('A');
  pending.resolve({name:'不应回写已删存档'});await request;
  assert.equal(e.ctx.charList.some(c=>c.name==='不应回写已删存档'),false);
  cleanup.resolve();await deletion;
});
