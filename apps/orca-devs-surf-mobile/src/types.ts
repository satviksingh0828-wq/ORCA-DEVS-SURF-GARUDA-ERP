export type AppTab = "scan" | "history" | "about";
export type FileAction = "add" | "replace";
export type FileSource = "document" | "photo";
export type FileKind = "image" | "pdf" | "word" | "other";
export type HistoryAction = "scan" | "view" | "add" | "replace";

export interface Credentials {
  endpointUrl: string;
  userId: string;
  password: string;
}

export interface UploadField {
  id: string;
  label: string;
  mimeType: string;
  hasValue?: boolean;
  valueUrl?: string;
  viewUrl?: string;
  addUrl?: string;
  replaceUrl?: string;
  allowView: boolean;
  allowAdd: boolean;
  allowReplace: boolean;
}

export interface QrManifest {
  recordId: string;
  title: string;
  uploads: UploadField[];
  creation?: PODCreationRequirements;
  scannedAt: string;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface PODCreationMetadata {
  deliveryDate: string;
  transporterLrNumber?: string;
  transporterLrDate?: string;
}

export interface PODCreationRequirements {
  deliveryDateRequired: boolean;
  transporterLrRequired: boolean;
}

export interface HistoryEntry {
  id: string;
  at: string;
  action: HistoryAction;
  recordId: string;
  recordTitle: string;
  uploadLabel?: string;
  fileName?: string;
  status: "success" | "failed";
  message: string;
}
