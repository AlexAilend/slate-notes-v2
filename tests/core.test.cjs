const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const root=require('node:path').join(__dirname,'..');
const storage=new Map();const node={addEventListener(){},close(){}};
const ctx={window:{SLATE_AUTH:{user:{id:'test-user'},profile:{},client:{}}},document:{getElementById:()=>node},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},console,structuredClone};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'/banks.js','utf8'),ctx);
let source=fs.readFileSync(root+'/app.js','utf8');
source=source.slice(0,source.lastIndexOf("  db.from('profiles')"))+"globalThis.api={validCount,selectQuestions,sameAnswer,isOrdering,optionOrder,displayAnswers,bs,state,banks};})();";
vm.runInContext(source,ctx);const a=ctx.api;
for(const bank of a.banks){
 a.state.activeBankId=bank.id;
 for(const n of [1,5,17,bank.questions.length]){
  assert(a.validCount(n,bank.questions.length));
  for(let repeat=0;repeat<20;repeat++){
   const ids=a.selectQuestions(bank.questions,n,true);assert.equal(ids.length,n);assert.equal(new Set(ids).size,n);
  }
 }
 for(const n of [0,-1,1.5,NaN,Infinity,bank.questions.length+1,'5'])assert(!a.validCount(n,bank.questions.length));
 assert.equal(JSON.stringify(a.selectQuestions(bank.questions,5,false)),JSON.stringify(bank.questions.slice(0,5).map(q=>q.id)));
 a.bs().shuffleStudy=true;
 for(const q of bank.questions){
  assert(a.sameAnswer(q,q.answer));assert(!a.sameAnswer(q,[]));
  if(a.isOrdering(q)){assert(!a.sameAnswer(q,[...q.answer].reverse()));continue;}
  const order=a.optionOrder(q,'study');assert.equal(new Set(order).size,Object.keys(q.options).length);
  assert.equal(JSON.stringify(a.optionOrder(q,'study')),JSON.stringify(order));
  const display=a.displayAnswers(q,q.answer,'study').split(', ');
  const selected=display.map(letter=>order[letter.charCodeAt(0)-65]);assert(a.sameAnswer(q,selected));
  assert(a.sameAnswer(q,[...selected].reverse()));
 }
}
const siem=a.banks.find(b=>b.id.includes('siem'));
assert.equal(JSON.stringify(siem.questions.find(q=>q.id===69).answer),'["B"]');
assert.equal(JSON.stringify(siem.questions.find(q=>q.id===74).answer),'["B","C"]');
assert(!source.includes('q.note'));
for(const b of a.banks)for(const q of b.questions)if(q.image)assert(fs.existsSync(root+'/'+q.image),q.image);
console.log('PASS: both banks, bounds, unique selection, stable shuffle, single/multi/ordering scoring, Q69/Q74, exhibits, hidden notes');
