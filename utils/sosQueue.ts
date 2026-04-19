// sosQueue.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'sos_message_queue';

export type AlertType = 'SOS' | 'BATTERY' | 'SAFEZONE';

// What gets QUEUED = internet-dependent extras only
// (native SMS is never queued — it fires instantly)
export type QueuedTaskType =
  | 'WHATSAPP_LOCATION_LINK'   // send live GPS link via WhatsApp
  | 'SERVER_LOG'               // log SOS event to your backend
  | 'EMAIL_ALERT';             // email to guardian

export interface QueuedMessage {
  id: string;
  alertType: AlertType;
  taskType: QueuedTaskType;
  recipient: string;
  payload: Record<string, string | number>;  // flexible data bag
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

// ── Helpers ───────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Core Queue Operations ─────────────────────────────────

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

  // Prevent duplicate queuing of same task for same recipient
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
  // Auto-discard messages that exceeded maxRetries
  await saveQueue(updated.filter((m) => m.retryCount <= m.maxRetries));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

// ── Retry Engine ──────────────────────────────────────────

export interface RetryResult {
  succeeded: string[];
  failed: string[];
}

/**
 * sendFn receives the full QueuedMessage so it can
 * handle each taskType differently (WhatsApp vs server log vs email)
 */
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