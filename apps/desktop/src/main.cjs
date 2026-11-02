const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
let mainWindow;
const historyPath = () => path.join(app.getPath("userData"), "conversation.json");
function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length > 100) throw new Error("Invalid conversation history.");
  return messages.map(m => {
    if (!m || !["user", "assistant", "system"].includes(m.role) || typeof m.content !== "string" || m.content.length > 30000) throw new Error("Invalid message.");
    return { role: m.role, content: m.content };
  });
}
function createWindow() {
  mainWindow = new BrowserWindow({width:1180,height:820,minWidth:760,minHeight:600,backgroundColor:"#080609",title:"Ultran",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.loadFile(path.join(__dirname,"index.html"));
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(url.startsWith("https://github.com/")||url.startsWith("https://huggingface.co/"))shell.openExternal(url);return {action:"deny"};});
  mainWindow.webContents.on("will-navigate",(event,url)=>{if(!url.startsWith("file://"))event.preventDefault();});
}
app.whenReady().then(()=>{
  ipcMain.handle("ultran:system",()=>({platform:process.platform,arch:process.arch,totalMemory:os.totalmem(),freeMemory:os.freemem(),cpuCount:os.cpus().length,hostname:os.hostname()}));
  ipcMain.handle("ultran:health",async(_event,endpoint)=>{
    if(endpoint!=="http://127.0.0.1:11435")throw new Error("Only the local Ultran AirLLM endpoint is allowed.");
    try{const r=await fetch(endpoint+"/health",{signal:AbortSignal.timeout(2500)});return {reachable:r.ok,...await r.json()};}catch(e){return {reachable:false,error:e.message};}
  });
  ipcMain.handle("ultran:chat",async(_event,{endpoint,messages,model,maxTokens})=>{
    if(endpoint!=="http://127.0.0.1:11435")throw new Error("Only the local Ultran AirLLM endpoint is allowed.");
    const safe=validMessages(messages);
    if(safe.length<1)throw new Error("Conversation is empty.");
    const r=await fetch(endpoint+"/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model,messages:safe,max_tokens:Math.max(1,Math.min(Number(maxTokens)||128,512)),temperature:0.2}),signal:AbortSignal.timeout(30*60*1000)});
    const payload=await r.json().catch(()=>({}));if(!r.ok)throw new Error(payload.detail||"Local model request failed ("+r.status+").");return payload;
  });
  ipcMain.handle("ultran:pick-file",async()=>{
    const result=await dialog.showOpenDialog(mainWindow,{title:"Choose a file to share with Ultran",properties:["openFile"],filters:[{name:"Text and source files",extensions:["txt","md","json","csv","py","js","ts","tsx","jsx","html","css","xml","yaml","yml","log","ini","toml"]}]});
    if(result.canceled||!result.filePaths[0])return {cancelled:true};
    const selected=result.filePaths[0],stat=await fs.stat(selected);
    if(!stat.isFile()||stat.size>1_000_000)throw new Error("Choose a text file smaller than 1 MB.");
    const ext=path.extname(selected).toLowerCase();
    if(![".txt",".md",".json",".csv",".py",".js",".ts",".tsx",".jsx",".html",".css",".xml",".yaml",".yml",".log",".ini",".toml"].includes(ext))throw new Error("Unsupported file type.");
    const content=await fs.readFile(selected,"utf8");
    return {cancelled:false,name:path.basename(selected),content:content.slice(0,500000),truncated:content.length>500000};
  });
  ipcMain.handle("ultran:load-history",async()=>{
    try { return validMessages(JSON.parse(await fs.readFile(historyPath(),"utf8"))); }
    catch(e) { if(e.code==="ENOENT")return []; return []; }
  });
  ipcMain.handle("ultran:save-history",async(_event,messages)=>{
    const safe=validMessages(messages);
    await fs.mkdir(app.getPath("userData"),{recursive:true});
    await fs.writeFile(historyPath(),JSON.stringify(safe),"utf8");
    return {saved:true,count:safe.length};
  });
  ipcMain.handle("ultran:open-external",async(_event,url)=>{if(typeof url!=="string"||!(url.startsWith("https://github.com/")||url.startsWith("https://huggingface.co/")))return false;await shell.openExternal(url);return true;});
  createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit();});
