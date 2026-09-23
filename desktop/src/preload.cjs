'use strict';

// Preload for the local splash/error pages and for the GUI.
//
// The GUI itself talks to the dsh host over HTTP, so the only thing it needs
// here is one narrow attention channel (issue #1498): `notify(kind)` reports
// that a run is waiting for the user or has settled, and the main process
// decides whether to flash the taskbar and play the system alert. The kind is
// re-validated in the main process; this bridge is a transport, not a policy.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /**
   * Report one attention signal to the main process.
   * @param {'approval' | 'completed' | 'interrupted'} kind
   */
  notify: (kind) => { ipcRenderer.send('desktop:attention', { kind }); },
  onStatus: (callback) => {
    ipcRenderer.on('desktop:status', (_event, text) => callback(text));
  },
  onError: (callback) => {
    ipcRenderer.on('desktop:error', (_event, payload) => callback(payload));
  },
  retry: () => ipcRenderer.send('desktop:retry'),
  revealLog: () => ipcRenderer.send('desktop:reveal-log'),
  quit: () => ipcRenderer.send('desktop:quit'),
});
