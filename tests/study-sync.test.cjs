const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'..');
const cloud=new Map();let offline=false;
function device(user='user-a'){
 const storage=new Map(),node={addEventListener(){},close(){}};
 const client={
  from(table){assert.equal(table,'study_progress');return {select(){return this},eq(_,id){this.user=id;return this},async order(){if(offline)throw Error('offline');return {data:[...cloud.values()].filter(r=>r.user_id===this.user).sort((a,b)=>b.revision-a.revision),error:null}}}},
  async rpc(name,p){assert.equal(name,'save_study_progress');if(offline)throw Error('offline');
   const key=user+':'+p.p_bank_id,old=cloud.get(key);
   if(old&&old.revision!==p.p_revision)return {data:[],error:null};
   const row={user_id:user,bank_id:p.p_bank_id,snapshot:structuredClone(p.p_snapshot),revision:(old?.revision||0)+1};
   cloud.set(key,row);return {data:[structuredClone(row)],error:null};
  }
 };
 const ctx={window:{SLATE_AUTH:{user:{id:user},profile:{},client}},document:{getElementById:()=>node},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},structuredClone,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'/banks.js','utf8'),ctx);
 let source=fs.readFileSync(root+'/app.js','utf8');
 source=source.slice(0,source.lastIndexOf("  db.from('profiles')"))+"globalThis.api={state,bs,banks,resetStudyProgress,init(){studySync=createStudySync();return studySync}};})();";
 vm.runInContext(source,ctx);ctx.api.sync=ctx.api.init();return {...ctx.api,storage};
}
(async()=>{
 const phone=device();const id=phone.banks.find(b=>b.id.includes('siem')).id;
 phone.state.activeBankId=id;const p=phone.bs();
 p.studyId=30;p.studyAnswers[29]=['A'];p.studyChecked[29]=true;p.statistics.studyChecks=1;
 await phone.sync.start();await phone.sync.flush();
 const pc=device();await pc.sync.start();
 assert.equal(pc.state.activeBankId,id);assert.equal(pc.bs().studyId,30);assert.equal(pc.bs().studyAnswers[29][0],'A');
 assert(pc.bs().studyChecked[29]);assert.equal(pc.bs().statistics.studyChecks,1);
 p.studyId=31;phone.sync.capture();await phone.sync.flush();await pc.sync.refresh();
 assert.equal(pc.bs().studyId,31);
 pc.bs().statistics.exams=[{uuid:'keep'}];pc.bs().exam={uuid:'keep-active',finished:true};
 pc.resetStudyProgress();await pc.sync.flush();await phone.sync.refresh();
 assert.equal(phone.bs().studyId,1);assert.equal(Object.keys(phone.bs().studyAnswers).length,0);
 assert.equal(pc.bs().statistics.exams[0].uuid,'keep');assert.equal(pc.bs().exam.uuid,'keep-active');
 offline=true;p.studyId=40;phone.sync.capture();await phone.sync.flush();
 assert(phone.sync.message.includes('пристрої'));offline=false;
 await phone.sync.refresh();await pc.sync.refresh();assert.equal(pc.bs().studyId,40);
 // Stale device cannot replace newer cloud progress; retain a recovery copy locally.
 const stale=device();await stale.sync.start();
 p.studyId=50;phone.sync.capture();await phone.sync.flush();
 stale.bs().studyId=22;stale.sync.capture();await stale.sync.flush();await new Promise(r=>setImmediate(r));
 assert.equal(cloud.get('user-a:'+id).snapshot.studyId,50);
 assert([...stale.storage.keys()].some(k=>k.includes('study-conflict')));
 const other=device('user-b');await other.sync.start();other.state.activeBankId=id;assert.equal(other.bs().studyId,1);
 console.log('PASS: phone→PC question 30, answers/checks, refresh, synced reset preserves exams, offline recovery, stale-write protection and account isolation');
})().catch(e=>{console.error(e);process.exitCode=1});
