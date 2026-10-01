export type AppTab = "scan" | "history" | "about";
export type FileAction = "add" | "replace";
export type FileSource = "document" | "photo";
export type FileKind = "image" | "pdf" | "word" | "other";
export type HistoryAction = "scan" | "view" | "add" | "replace" | "update";

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

export type MetadataFieldType = "text" | "date" | "number" | "select";

export interface MetadataFieldOption {
  label: string;
  value: string;
}

export interface MetadataField {
  id: string;
  label: string;
  type: MetadataFieldType;
  value: string;
  required: boolean;
  editable: boolean;
  syncOnly?: boolean;
  options?: MetadataFieldOption[];
}

export interface ManifestMetadata {
  mode: "create" | "update";
  fields: MetadataField[];
  updateUrl?: string;
}

export interface QrManifest {
  recordId: string;
  title: string;
  uploads: UploadField[];
  metadata?: ManifestMetadata;
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
