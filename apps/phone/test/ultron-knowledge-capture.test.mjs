import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import vm from 'node:vm';
const load=(path,extra={})=>{const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');const js=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});const module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,Date,Math,Number,String,Array,Object,Set,RegExp,...extra,require:(id)=>id==='./ultron-knowledge-state'?knowledge:require(id)});return module.exports;};
const source=fs.readFileSync(new URL('../src/ultron-knowledge-state.ts',import.meta.url),'utf8');const js=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});const m={exports:{}};vm.runInNewContext(js,{module:m,exports:m.exports,Date,Math,Number,String,Array,Object});const knowledge=m.exports;
const capture=load('../src/ultron-knowledge-capture.ts');
test('captures explicit user decisions but ignores ordinary conversation and secrets',()=>{
 const empty=knowledge.emptyKnowledgeState(1);
 const choice=capture.captureExplicitKnowledge(empty,{id:'choice',text:'From now on, only use the main branch for pushes',source:'user_statement'},2);
 assert.equal(choice.captured.length,1);assert.equal(choice.state.records[0].kind,'user_decision');
 const casual=capture.captureExplicitKnowledge(empty,{id:'casual',text:'That sounds interesting and useful to me',source:'user_statement'},3);
 assert.equal(casual.captured.length,0);
 const secret=capture.captureExplicitKnowledge(empty,{id:'secret',text:'My API key is abcdefghijklmnop',source:'user_statement'},4);
 assert.equal(secret.captured.length,0);
});
test('detects opposing explicit statements and marks both claims for clarification',()=>{
 let state=knowledge.recordKnowledge(knowledge.emptyKnowledgeState(1),{id:'old',kind:'user_decision',claim:'I prefer dark mode for the application',source:'user_statement',confidence:1},2);
 const result=capture.captureExplicitKnowledge(state,{id:'new',text:'I do not prefer dark mode for the application',source:'user_statement'},3);
 assert.equal(result.conflicts[0].reason,'opposite_polarity');
 assert.equal(result.state.records.find(x=>x.id==='old').status,'disputed');
 assert.equal(result.state.records.find(x=>x.id==='new').status,'active');
});
test('explicit correction supersedes a sufficiently similar previous decision',()=>{
 let state=knowledge.recordKnowledge(knowledge.emptyKnowledgeState(1),{id:'old',kind:'user_decision',claim:'I prefer dark mode for the application',source:'user_statement',confidence:1},2);
 const result=capture.captureExplicitKnowledge(state,{id:'new',text:'Correction: I prefer light mode for the application instead',source:'user_correction'},3);
 assert.ok(result.conflicts.some(x=>x.resolution==='supersede'));
 assert.equal(result.state.records.find(x=>x.id==='old').status,'superseded');
});
test('near duplicates are not stored twice and malformed evidence fails closed',()=>{
 let state=knowledge.recordKnowledge(knowledge.emptyKnowledgeState(1),{id:'old',kind:'user_decision',claim:'I prefer dark mode for the application',source:'user_statement',confidence:1},2);
 const duplicate=capture.captureExplicitKnowledge(state,{id:'new',text:'I prefer dark mode for the application',source:'user_statement'},3);
 assert.equal(duplicate.captured.length,0);
 assert.equal(capture.validateKnowledgeEvidence({id:'x',text:'hello',source:'system_override'}),null);
});
