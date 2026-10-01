import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Credentials, HistoryEntry } from "../types";

const CREDENTIALS_KEY = "orca-devs-surf.credentials.v1";
const HISTORY_KEY = "orca-devs-surf.history.v1";
const HISTORY_LIMIT = 100;

export async function loadCredentials(): Promise<Credentials | null> {
  const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Credentials>;
    if (
      typeof value.endpointUrl === "string" &&
      typeof value.userId === "string" &&
      typeof value.password === "string"
    ) {
      return { endpointUrl: value.endpointUrl, userId: value.userId, password: value.password };
    }
  } catch {
    // Remove a corrupted record instead of leaving unusable credentials around.
  }
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
  return null;
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as HistoryEntry[];
  } catch {
    // A malformed local history should not prevent login or scanning.
  }
  return [];
}

export async function saveHistoryItem(item: HistoryEntry): Promise<HistoryEntry[]> {
  const existing = await loadHistory();
  const next = [item, ...existing].slice(0, HISTORY_LIMIT);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}
