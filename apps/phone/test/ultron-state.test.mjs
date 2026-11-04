import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/ultron-state.ts',import.meta.url),'utf8');
const js=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
const module={exports:{}}; vm.runInNewContext(js,{module,exports:module.exports,Date,Math,Number,String,Array,Object});
const state=module.exports;
const ledger={id:'task-a',task:'Implement persistent state',profile:{intent:'implementation',risk:'moderate',depth:'deep',reasons:['multi-step']},createdAt:100,updatedAt:200,status:'active',constraints:['keep main'],steps:[{id:'understand',status:'completed',objective:'Understand request',resultSummary:'Captured scope',evidence:'message-1'},{id:'verify',status:'running',objective:'Verify persistence'}]};
test('checkpoint round-trips bounded explicit progress and preserves unresolved work',()=>{
 const c=state.createUltronCheckpoint('chat-1',ledger,300); const restored=state.validateUltronCheckpoint(JSON.parse(JSON.stringify(c)),'chat-1',400);
 assert.equal(restored.taskId,'task-a'); assert.equal(restored.completed[0].evidenceRef,'message-1'); assert.equal(restored.unresolved[0].status,'running'); assert.equal(restored.resumeStepId,'verify');
});
test('checkpoint rejects corrupt versions, timestamps and cross-conversation restore',()=>{
 const c=state.createUltronCheckpoint('chat-1',ledger,300); assert.equal(state.validateUltronCheckpoint({...c,schemaVersion:9}),null); assert.equal(state.validateUltronCheckpoint({...c,updatedAt:1}),null); assert.equal(state.validateUltronCheckpoint(c,'chat-2'),null);
});
test('stale checkpoints are retained as data but not resumed',()=>{
 const c=state.createUltronCheckpoint('chat-1',ledger,300); const old=state.validateUltronCheckpoint(c,'chat-1',300+31*86400000); assert.equal(old.stale,true); assert.equal(state.buildUltronCheckpointPrompt(old),'');
});
test('checkpoint prompt contains summaries, not raw hidden reasoning, and prioritizes current instructions',()=>{
 const c=state.createUltronCheckpoint('chat-1',{...ledger,task:'User task',profile:{...ledger.profile,reasons:['Explicit decision']},steps:[{id:'reason',status:'completed',objective:'Reason',resultSummary:'Selected option A',evidence:'test-run-7'}]},300);
 const prompt=state.buildUltronCheckpointPrompt(c); assert.match(prompt,/Selected option A/); assert.match(prompt,/test-run-7/); assert.match(prompt,/latest user message overrides/); assert.doesNotMatch(prompt,/chain.of.thought contents/i);
});
test('completed checkpoints do not become continuation instructions',()=>{
 const c=state.createUltronCheckpoint('chat-1',{...ledger,status:'completed',steps:[]},300); assert.equal(state.buildUltronCheckpointPrompt(c),'');
});
