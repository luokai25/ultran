const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("ultranDesktop",Object.freeze({
 system:()=>ipcRenderer.invoke("ultran:system"),
 health:(endpoint)=>ipcRenderer.invoke("ultran:health",endpoint),
 setupRuntime:()=>ipcRenderer.invoke("ultran:setup-runtime"),
 onSetupEvent:(callback)=>{if(typeof callback!=="function")return ()=>{};const listener=(_event,payload)=>callback(payload);ipcRenderer.on("ultran:setup-event",listener);return ()=>ipcRenderer.removeListener("ultran:setup-event",listener);},
 startRuntime:(model)=>ipcRenderer.invoke("ultran:start-runtime",model),
 stopRuntime:()=>ipcRenderer.invoke("ultran:stop-runtime"),
 chat:(request)=>ipcRenderer.invoke("ultran:chat",request),
 pickFile:()=>ipcRenderer.invoke("ultran:pick-file"),
 loadHistory:()=>ipcRenderer.invoke("ultran:load-history"),
 saveHistory:(messages)=>ipcRenderer.invoke("ultran:save-history",messages),
 openExternal:(url)=>ipcRenderer.invoke("ultran:open-external",url)
}));
