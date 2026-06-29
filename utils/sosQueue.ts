import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

const QUEUE_KEY = 'sos_message_queue';

export type AlertType = 'SOS' | 'BATTERY' | 'SAFEZONE';

export type QueuedTaskType =
  | 'WHATSAPP_LOCATION_LINK'
  | 'SERVER_LOG'
  | 'EMAIL_ALERT';

export interface QueuedMessage {
  id: string;
  alertType: AlertType;
  taskType: QueuedTaskType;
  recipient: string;
  payload: Record<string, string | number>;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getQueue(): Promise<QueuedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedMessage[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function addToQueue(
  alertType: AlertType,
  taskType: QueuedTaskType,
  recipient: string,
  payload: Record<string, string | number>,
  maxRetries = 10
): Promise<QueuedMessage> {
  const queue = await getQueue();
  const duplicate = queue.find(
    (m) => m.taskType === taskType && m.recipient === recipient
  );
  if (duplicate) return duplicate;

  const msg: QueuedMessage = {
    id: generateId(),
    alertType,
    taskType,
    recipient,
    payload,
    timestamp: Date.now(),
    retryCount: 0,
    maxRetries,
  };
  queue.push(msg);
  await saveQueue(queue);
  return msg;
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  await saveQueue(queue.filter((m) => m.id !== id));
}

async function incrementRetry(id: string): Promise<void> {
  const queue = await getQueue();
  const updated = queue.map((m) =>
    m.id === id ? { ...m, retryCount: m.retryCount + 1 } : m
  );
  await saveQueue(updated.filter((m) => m.retryCount <= m.maxRetries));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

// ── WhatsApp sender ──────────────────────────────────────
export const sendWhatsAppMessage = async (
  phone: string,
  message: string
): Promise<boolean> => {
  try {
    // Remove + from phone number for WhatsApp URL
    const cleanPhone = phone.replace(/\D/g, '');
    const encodedMsg = encodeURIComponent(message);
    const url = `whatsapp://send?phone=${cleanPhone}&text=${encodedMsg}`;
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
};

// ── Retry engine ─────────────────────────────────────────
export interface RetryResult {
  succeeded: string[];
  failed: string[];
}

export async function retryQueue(
  sendFn: (msg: QueuedMessage) => Promise<boolean>
): Promise<RetryResult> {
  const queue = await getQueue();
  const result: RetryResult = { succeeded: [], failed: [] };

  for (const msg of queue) {
    try {
      const ok = await sendFn(msg);
      if (ok) {
        await removeFromQueue(msg.id);
        result.succeeded.push(msg.id);
      } else {
        await incrementRetry(msg.id);
        result.failed.push(msg.id);
      }
    } catch {
      await incrementRetry(msg.id);
      result.failed.push(msg.id);
    }
  }
  return result;
}