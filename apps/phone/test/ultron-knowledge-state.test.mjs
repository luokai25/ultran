import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/ultron-knowledge-state.ts',import.meta.url),'utf8');
const js=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,Date,Math,Number,String,Array,Object});
const k=module.exports;
test('knowledge records distinguish facts, user decisions and assumptions with provenance',()=>{
 let s=k.emptyKnowledgeState(10);
 s=k.recordKnowledge(s,{id:'fact-1',kind:'fact',claim:'Repository branch is main',source:'user_statement',confidence:1,evidenceRefs:['chat-1']},20);
 s=k.recordKnowledge(s,{id:'choice-1',kind:'user_decision',claim:'Only publish to main',source:'explicit_user_choice',confidence:1,dependsOn:['fact-1']},30);
 s=k.recordKnowledge(s,{id:'guess-1',kind:'assumption',claim:'The user prefers offline models',source:'inference',confidence:.45},40);
 assert.equal(s.records.length,3);assert.equal(s.records[1].kind,'user_decision');assert.equal(s.records[2].confidence,.45);
});
test('superseding a record preserves history and prevents the old claim staying active',()=>{
 let s=k.recordKnowledge(k.emptyKnowledgeState(1),{id:'old',kind:'fact',claim:'Version is 2',source:'user',confidence:1},2);
 s=k.recordKnowledge(s,{id:'new',kind:'fact',claim:'Version is 3',source:'user correction',confidence:1,supersedes:['old']},3);
 assert.equal(s.records.find(r=>r.id==='old').status,'superseded');assert.equal(s.records.find(r=>r.id==='new').status,'active');
});
test('disputing a premise invalidates dependent active decisions',()=>{
 let s=k.recordKnowledge(k.emptyKnowledgeState(1),{id:'premise',kind:'fact',claim:'Feature exists',source:'tool',confidence:.9},2);
 s=k.recordKnowledge(s,{id:'decision',kind:'user_decision',claim:'Use the feature',source:'user',confidence:1,dependsOn:['premise']},3);
 s=k.disputeKnowledge(s,'premise','contradictory evidence',4);
 assert.equal(s.records.find(r=>r.id==='premise').status,'disputed');assert.equal(s.records.find(r=>r.id==='decision').status,'disputed');
});
test('expired assumptions are excluded from active knowledge context',()=>{
 let s=k.recordKnowledge(k.emptyKnowledgeState(1),{id:'temporary',kind:'assumption',claim:'Temporary condition',source:'inference',confidence:.3,expiresAt:10},2);
 s=k.expireKnowledge(s,11);assert.equal(s.records[0].status,'expired');assert.doesNotMatch(k.buildKnowledgePrompt(s,11),/Temporary condition/);
});
test('corrupt imports fail closed and prompt keeps assumptions explicitly tentative',()=>{
 const invalid=k.validateKnowledgeState({version:7,records:[{}],revision:-1},10);assert.equal(invalid.records.length,0);
 let s=k.recordKnowledge(k.emptyKnowledgeState(1),{id:'a',kind:'assumption',claim:'Possible preference',source:'inference',confidence:.4},2);
 const prompt=k.buildKnowledgePrompt(s,3);assert.match(prompt,/assumptions remain tentative/);assert.match(prompt,/confidence 0.40/);assert.match(prompt,/Current user statements override/);
});
