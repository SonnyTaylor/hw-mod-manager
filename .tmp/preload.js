(()=>{"use strict";const e=require("electron"),n={steam:{call:(n,...i)=>e.ipcRenderer.invoke("native:steam",n,i)},presence:{setState:n=>e.ipcRenderer.send("presence:set-state",n)},cursorPos:()=>e.ipcRenderer.invoke("native:cursorPos"),exit:()=>e.ipcRenderer.send("native:exit"),loaded:()=>e.ipcRenderer.send("native:loaded"),deepLink:{pending:()=>e.ipcRenderer.invoke("native:deeplink:pending"),onOpen:n=>{e.ipcRenderer.on("native:deeplink",(e,i)=>n(i))}},overlay:{onActivated:n=>{e.ipcRenderer.on("native:overlayActivated",(e,i)=>n(Boolean(i)))}},fullscreen:{set:n=>e.ipcRenderer.send("native:fullscreen:set",n),get:()=>!0===e.ipcRenderer.sendSync("native:fullscreen:get"),onChange:n=>{e.ipcRenderer.on("native:fullscreenChanged",(e,i)=>n(Boolean(i)))}},auth:{login:(n,i)=>e.ipcRenderer.invoke("native:auth:login",n,i),getUser:()=>e.ipcRenderer.invoke("native:auth:getUser"),logout:()=>e.ipcRenderer.invoke("native:auth:logout"),steamLogin:n=>e.ipcRenderer.invoke("native:auth:steamLogin",n),linkSteam:()=>e.ipcRenderer.invoke("native:auth:linkSteam")},friends:{online:()=>e.ipcRenderer.invoke("native:friends:online"),onChanged:n=>{e.ipcRenderer.on("native:friends:changed",(e,i)=>n(Array.isArray(i)?i:[]))},findByTjfName:n=>e.ipcRenderer.invoke("native:friends:findByTjfName",n),names:()=>e.ipcRenderer.invoke("native:friends:names"),onNamesChanged:n=>{e.ipcRenderer.on("native:friends:namesChanged",(e,i)=>n(Array.isArray(i)?i:[]))}},downloads:{list:()=>e.ipcRenderer.invoke("native:downloads:list"),save:(n,i,r)=>e.ipcRenderer.invoke("native:downloads:save",n,i,r),load:n=>e.ipcRenderer.invoke("native:downloads:load",n),delete:n=>e.ipcRenderer.invoke("native:downloads:delete",n)}};e.contextBridge.exposeInMainWorld("hwNative",n)})();
//# sourceMappingURL=preload.js.map
// === HW MOD PRE-HOOK (added by HW-ModManager) ===
// Runs in the page's main world BEFORE the game scripts. Pixi's Ticker
// invokes listeners via fn.call(app) every frame — a transient
// Function.prototype.call trap captures the Application instance the
// obfuscated game otherwise keeps hidden in closures.
(function () {
    try {
        window.__HW_DISCOVERY__ = { app: null };
        const origCall = Function.prototype.call;
        let done = false;
        Function.prototype.call = function (...args) {
            if (!done) {
                try {
                    const c = args[0];
                    if (c && c.stage && c.renderer) {
                        done = true;
                        window.__HW_DISCOVERY__.app = c;
                        Function.prototype.call = origCall;
                    }
                } catch (e) {}
            }
            return origCall.apply(this, args);
        };
        setTimeout(function () { if (!done) Function.prototype.call = origCall; }, 60000);
    } catch (e) {}
})();
