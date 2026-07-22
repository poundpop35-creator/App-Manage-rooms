const DB = Object.freeze({
  spreadsheetId: '1d7wQuQXtHht9O04eB_3d8OQiiHvUrx8iDq1uhtepIxI',
  sheets: {
    Admins: ['id','username','password_hash','salt','role','status','created_at','updated_at'],
    Events: ['id','name','subtitle','logo','created_by','created_at','updated_at'],
    Guests: ['id','event_id','seq','name1','dept1','prov1','type','name2','dept2','prov2','hotel','hotel_color','room','car','time','timeReturn','coord1','phone','coord2','driverPhone','note','updated_at'],
    Settings: ['id','key','value_json','updated_at']
  }
});

function doGet() {
  ensureSchema_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('RoomFlow')
    .addMetaTag('viewport','width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Run once from the Apps Script editor.
 * Creates the four database tabs and, if needed, a temporary Super Admin.
 */
function setupDatabase() {
  assertOwnerExecution_();
  ensureSchema_();
  let temporaryAdmin = null;
  if (!readRows_('Admins').some(row => row.role === 'super')) {
    const password = randomSecret_(14);
    insertAdmin_({username:'admin',password:password,role:'super',status:'active'});
    temporaryAdmin = {username:'admin',password:password};
    console.log('Temporary Super Admin: '+JSON.stringify(temporaryAdmin));
  }
  return {
    spreadsheetId: DB.spreadsheetId,
    tabs: Object.keys(DB.sheets),
    temporaryAdmin: temporaryAdmin,
    message: temporaryAdmin ? 'บันทึกรหัสผ่านชั่วคราวนี้ แล้วเปลี่ยนหลังเข้าสู่ระบบ' : 'ฐานข้อมูลพร้อมใช้งาน'
  };
}

// ---------- Public API ----------

function getPublicBootstrap() {
  ensureSchema_();
  const settings = getSettings_();
  const events = readRows_('Events')
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    .map(event => ({id:event.id,name:event.name,subtitle:event.subtitle,logo:event.logo||'🏨'}));
  return {settings:settings,events:events};
}

function getPublicEvent(eventId) {
  ensureSchema_();
  const event = findEvent_(eventId);
  if (!event) throw new Error('ไม่พบรหัสงานนี้');
  return {
    event: {id:event.id,name:event.name,subtitle:event.subtitle,logo:event.logo||'🏨'},
    guests: guestsForEvent_(event.id),
    colors: colorsForEvent_(event.id)
  };
}

function login(username,password) {
  ensureSchema_();
  const admin = readRows_('Admins').find(row => sameText_(row.username,username));
  if (!admin || hashPassword_(String(password||''),admin.salt) !== admin.password_hash) {
    throw new Error('Username หรือ Password ไม่ถูกต้อง');
  }
  const token = Utilities.getUuid()+Utilities.getUuid();
  CacheService.getScriptCache().put('session:'+token,JSON.stringify({id:admin.id,username:admin.username}),21600);
  return {token:token,user:publicAdmin_(admin)};
}

function register(username,password) {
  ensureSchema_();
  return withWriteLock_(()=>{
    const user=String(username||'').trim();
    const pass=String(password||'');
    if (user.length<3 || pass.length<6) throw new Error('Username อย่างน้อย 3 ตัว และ Password อย่างน้อย 6 ตัว');
    if (readRows_('Admins').some(row => sameText_(row.username,user))) throw new Error('Username นี้ถูกใช้แล้ว');
    return publicAdmin_(insertAdmin_({username:user,password:pass,role:'sub',status:'pending'}));
  });
}

// ---------- Authenticated API ----------

function getAdminDashboard(token) {
  const actor=requireAdmin_(token);
  const allEvents=readRows_('Events');
  const events=(actor.role==='super'?allEvents:allEvents.filter(event=>sameText_(event.created_by,actor.username)))
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    .map(event=>Object.assign({},event,{guest_count:countGuests_(event.id)}));
  const result={user:publicAdmin_(actor),events:events,settings:getSettings_()};
  if (actor.role==='super') result.admins=readRows_('Admins').sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).map(publicAdmin_);
  return result;
}

function createEvent(token,payload) {
  return withWriteLock_(()=>{
    const actor=requireAdmin_(token);
    const id=String((payload||{}).id||'').trim();
    const name=String((payload||{}).name||'').trim();
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(id)) throw new Error('รหัสงานใช้ A-Z, 0-9, _ หรือ - จำนวน 3–40 ตัว');
    if (!name) throw new Error('กรุณาระบุชื่องาน');
    if (findEvent_(id)) throw new Error('รหัสงานนี้มีอยู่แล้ว');
    const now=nowIso_();
    const row={id:id,name:name,subtitle:String(payload.subtitle||'รายชื่อผู้เข้าพัก'),logo:String(payload.logo||'🏨'),created_by:actor.username,created_at:now,updated_at:now};
    appendRow_('Events',row);
    return row;
  });
}

function updateEvent(token,eventId,patch) {
  return withWriteLock_(()=>{
    const actor=requireAdmin_(token),event=requireOwnedEvent_(actor,eventId);
    const allowed=['name','subtitle','logo'],updates={updated_at:nowIso_()};
    allowed.forEach(key=>{if(Object.prototype.hasOwnProperty.call(patch||{},key))updates[key]=String(patch[key]||'');});
    updateById_('Events',event.id,updates);
    return Object.assign({},event,updates);
  });
}

function deleteEvent(token,eventId) {
  return withWriteLock_(()=>{
    const actor=requireAdmin_(token),event=requireOwnedEvent_(actor,eventId);
    deleteMatching_('Guests',row=>sameText_(row.event_id,event.id));
    deleteMatching_('Events',row=>sameText_(row.id,event.id));
    return true;
  });
}

function getEventForAdmin(token,eventId) {
  const actor=requireAdmin_(token),event=requireOwnedEvent_(actor,eventId);
  return {event:event,guests:guestsForEvent_(event.id),colors:colorsForEvent_(event.id)};
}

function saveGuests(token,eventId,guests,colors) {
  return withWriteLock_(()=>{
    const actor=requireAdmin_(token),event=requireOwnedEvent_(actor,eventId);
    const clean=Array.isArray(guests)?guests.map(normalizeGuest_).filter(row=>row.name1&&row.name1!=='-'):[];
    deleteMatching_('Guests',row=>sameText_(row.event_id,event.id));
    const palette=colors||{},updated=nowIso_();
    clean.forEach(guest=>appendRow_('Guests',Object.assign({
      id:Utilities.getUuid(),event_id:event.id,hotel_color:palette[guest.hotel]||'',updated_at:updated
    },guest)));
    return {count:clean.length,updatedAt:updated};
  });
}

function saveAppSettings(token,settings) {
  return withWriteLock_(()=>{
    requireSuper_(token);
    const data={
      appName:String((settings||{}).appName||'RoomFlow').slice(0,80),
      appSub:String((settings||{}).appSub||'ค้นหาข้อมูลผู้เข้าพัก').slice(0,160),
      logo:String((settings||{}).logo||'🏨').slice(0,8)
    };
    const rows=readRows_('Settings'),current=rows.find(row=>row.key==='app_settings');
    if(current) updateById_('Settings',current.id,{value_json:JSON.stringify(data),updated_at:nowIso_()});
    else appendRow_('Settings',{id:Utilities.getUuid(),key:'app_settings',value_json:JSON.stringify(data),updated_at:nowIso_()});
    return data;
  });
}

function approveAdmin(token,adminId) {
  return withWriteLock_(()=>{
    requireSuper_(token);
    updateById_('Admins',adminId,{status:'active',updated_at:nowIso_()});
    return true;
  });
}

function deleteAdmin(token,adminId) {
  return withWriteLock_(()=>{
    const actor=requireSuper_(token);
    const target=readRows_('Admins').find(row=>String(row.id)===String(adminId));
    if (!target) return true;
    if (target.role==='super') throw new Error('ไม่สามารถลบ Super Admin');
    if (String(target.id)===String(actor.id)) throw new Error('ไม่สามารถลบบัญชีที่กำลังใช้งาน');
    deleteMatching_('Admins',row=>String(row.id)===String(adminId));
    return true;
  });
}

function changeAdminPassword(token,adminId,newPassword) {
  return withWriteLock_(()=>{
    const actor=requireAdmin_(token);
    if (actor.role!=='super' && String(actor.id)!==String(adminId)) throw new Error('ไม่มีสิทธิ์เปลี่ยนรหัสผ่านนี้');
    const password=String(newPassword||'');
    if(password.length<6) throw new Error('Password อย่างน้อย 6 ตัวอักษร');
    const salt=randomSecret_(24);
    updateById_('Admins',adminId,{salt:salt,password_hash:hashPassword_(password,salt),updated_at:nowIso_()});
    return true;
  });
}

// ---------- Data helpers ----------

function ensureSchema_() {
  const ss=SpreadsheetApp.openById(DB.spreadsheetId);
  Object.keys(DB.sheets).forEach(name=>{
    let sheet=ss.getSheetByName(name);
    if(!sheet) sheet=ss.insertSheet(name);
    const headers=DB.sheets[name];
    if(sheet.getLastRow()===0){
      sheet.getRange(1,1,1,headers.length).setValues([headers])
        .setFontWeight('bold').setFontColor('#ffffff').setBackground('#2563eb');
      sheet.setFrozenRows(1);
      sheet.getRange(1,1,Math.max(sheet.getMaxRows(),2),headers.length).setVerticalAlignment('middle');
    }else{
      const width=Math.max(sheet.getLastColumn(),headers.length);
      const existing=sheet.getRange(1,1,1,width).getDisplayValues()[0];
      headers.forEach((header,index)=>{if(!existing[index])sheet.getRange(1,index+1).setValue(header);});
    }
  });
  const settings=readRows_('Settings');
  if(!settings.some(row=>row.key==='app_settings')){
    appendRow_('Settings',{id:Utilities.getUuid(),key:'app_settings',value_json:JSON.stringify({appName:'RoomFlow',appSub:'ค้นหาข้อมูลผู้เข้าพักด้วยรหัสงาน',logo:'🏨'}),updated_at:nowIso_()});
  }
}

function getSettings_() {
  const row=readRows_('Settings').find(item=>item.key==='app_settings');
  return row?parseJson_(row.value_json,{appName:'RoomFlow',appSub:'ค้นหาข้อมูลผู้เข้าพัก',logo:'🏨'}):{appName:'RoomFlow',appSub:'ค้นหาข้อมูลผู้เข้าพัก',logo:'🏨'};
}
function findEvent_(eventId) {return readRows_('Events').find(row=>sameText_(row.id,eventId));}
function requireOwnedEvent_(actor,eventId) {
  const event=findEvent_(eventId);
  if(!event) throw new Error('ไม่พบงาน');
  if(actor.role!=='super'&&!sameText_(event.created_by,actor.username))throw new Error('ไม่มีสิทธิ์จัดการงานนี้');
  return event;
}
function countGuests_(eventId){return readRows_('Guests').filter(row=>sameText_(row.event_id,eventId)).length;}
function guestsForEvent_(eventId){
  return readRows_('Guests').filter(row=>sameText_(row.event_id,eventId)).map(row=>{
    const out={};
    guestFields_().forEach(field=>out[field]=row[field]||'-');
    return out;
  }).sort((a,b)=>(parseInt(a.seq,10)||0)-(parseInt(b.seq,10)||0));
}
function colorsForEvent_(eventId){
  const colors={};
  readRows_('Guests').filter(row=>sameText_(row.event_id,eventId)).forEach(row=>{
    if(row.hotel&&row.hotel!=='-'&&row.hotel_color)colors[row.hotel]=row.hotel_color;
  });
  return colors;
}
function guestFields_(){return ['seq','name1','dept1','prov1','type','name2','dept2','prov2','hotel','room','car','time','timeReturn','coord1','phone','coord2','driverPhone','note'];}
function normalizeGuest_(row){
  const out={};guestFields_().forEach(field=>out[field]=String((row||{})[field]??'').trim()||'-');
  return out;
}

function insertAdmin_(input){
  const salt=randomSecret_(24),now=nowIso_();
  const row={id:Utilities.getUuid(),username:String(input.username).trim(),password_hash:hashPassword_(input.password,salt),salt:salt,role:input.role||'sub',status:input.status||'pending',created_at:now,updated_at:now};
  appendRow_('Admins',row);return row;
}
function publicAdmin_(row){return{id:row.id,username:row.username,role:row.role,status:row.status,created_at:row.created_at,updated_at:row.updated_at};}
function requireAdmin_(token){
  if(!token)throw new Error('กรุณาเข้าสู่ระบบ');
  const cached=CacheService.getScriptCache().get('session:'+token);
  if(!cached)throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const session=JSON.parse(cached);
  const admin=readRows_('Admins').find(row=>String(row.id)===String(session.id)&&sameText_(row.username,session.username));
  if(!admin||admin.status!=='active')throw new Error('บัญชียังไม่ได้รับอนุมัติหรือถูกยกเลิก');
  return admin;
}
function requireSuper_(token){const admin=requireAdmin_(token);if(admin.role!=='super')throw new Error('เฉพาะ Super Admin เท่านั้น');return admin;}

function readRows_(name){
  const sheet=SpreadsheetApp.openById(DB.spreadsheetId).getSheetByName(name),headers=DB.sheets[name];
  if(!sheet||sheet.getLastRow()<2)return[];
  const values=sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues();
  return values.map(valuesRow=>Object.fromEntries(headers.map((header,index)=>[header,valuesRow[index]])))
    .filter(row=>headers.some(header=>row[header]!==''&&row[header]!==null));
}
function appendRow_(name,obj){
  const sheet=SpreadsheetApp.openById(DB.spreadsheetId).getSheetByName(name),headers=DB.sheets[name];
  sheet.appendRow(headers.map(header=>obj[header]===undefined?'':obj[header]));
}
function updateById_(name,id,patch){
  const sheet=SpreadsheetApp.openById(DB.spreadsheetId).getSheetByName(name),headers=DB.sheets[name];
  if(!sheet||sheet.getLastRow()<2)return;
  const values=sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues(),idIndex=headers.indexOf('id');
  for(let i=0;i<values.length;i++)if(String(values[i][idIndex])===String(id)){
    Object.keys(patch).forEach(key=>{const col=headers.indexOf(key);if(col>=0)values[i][col]=patch[key];});
    sheet.getRange(i+2,1,1,headers.length).setValues([values[i]]);return;
  }
}
function deleteMatching_(name,predicate){
  const sheet=SpreadsheetApp.openById(DB.spreadsheetId).getSheetByName(name),headers=DB.sheets[name];
  if(!sheet||sheet.getLastRow()<2)return;
  const values=sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues();
  for(let i=values.length-1;i>=0;i--){
    const row=Object.fromEntries(headers.map((header,index)=>[header,values[i][index]]));
    if(predicate(row))sheet.deleteRow(i+2);
  }
}
function withWriteLock_(fn){const lock=LockService.getScriptLock();lock.waitLock(30000);try{return fn();}finally{lock.releaseLock();}}
function parseJson_(value,fallback){try{return JSON.parse(String(value||''));}catch(error){return fallback;}}
function sameText_(a,b){return String(a||'').trim().toLocaleLowerCase('th-TH')===String(b||'').trim().toLocaleLowerCase('th-TH');}
function nowIso_(){return new Date().toISOString();}
function randomSecret_(length){return(Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'')).slice(0,length);}
function hashPassword_(password,salt){
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(salt)+'|'+String(password),Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes);
}
function assertOwnerExecution_(){
  const active=Session.getActiveUser().getEmail(),effective=Session.getEffectiveUser().getEmail();
  if(!active||!effective||active!==effective)throw new Error('ต้องรัน setupDatabase จาก Apps Script Editor โดยเจ้าของชีต');
}
