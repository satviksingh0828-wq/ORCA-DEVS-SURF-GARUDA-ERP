const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  screenCaptureScope: (scope) => ipcRenderer.invoke('screen-capture-scope', scope),
  systemInput: (input) => ipcRenderer.invoke('system-input', input),
  /** Execute a per-company database operation and return { data, error } */
  dbOp: (descriptor) => ipcRenderer.invoke('db-op', descriptor),

  /** Company management */
  companiesList:    ()       => ipcRenderer.invoke('companies-list'),
  companiesCreate:  (data)   => ipcRenderer.invoke('companies-create', data),
  companiesUpdate:  (data)   => ipcRenderer.invoke('companies-update', data),
  companiesDelete:  (id)     => ipcRenderer.invoke('companies-delete', id),
  companiesSaveLogo:(data)   => ipcRenderer.invoke('companies-save-logo', data),
  companiesGetLogo: (id)     => ipcRenderer.invoke('companies-get-logo', id),
  backupStatus:    ()         => ipcRenderer.invoke('backup-status'),
  backupStart:     ()         => ipcRenderer.invoke('backup-start'),
  employeeDocumentsList:   (data) => ipcRenderer.invoke('employee-documents-list', data),
  employeeDocumentsUpload: (data) => ipcRenderer.invoke('employee-documents-upload', data),
  employeeDocumentsGet:    (data) => ipcRenderer.invoke('employee-documents-get', data),
  employeeDocumentsDelete: (data) => ipcRenderer.invoke('employee-documents-delete', data),

  /** WhatsApp — all messaging goes through Electron main process IPC */
  waStatus:  ()     => ipcRenderer.invoke('wa-status'),
  waInit:    ()     => ipcRenderer.invoke('wa-init'),
  waLogout:  ()     => ipcRenderer.invoke('wa-logout'),
  waSend:    (data) => ipcRenderer.invoke('wa-send', data),
  waSendDoc: (data) => ipcRenderer.invoke('wa-send-doc', data),
});
