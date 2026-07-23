export interface RealtimeEvent<T = unknown> {
  v: number;
  type: string;
  roomId: string;
  actorId: string;
  payload: T;
  ts: string;
}

type Listener = (event: RealtimeEvent) => void;

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";
const MAX_BACKOFF_MS = 15_000;

/**
 * A single shared socket for the whole app (not one per component) so
 * multiple views can subscribe to different rooms over one connection.
 * Auth happens via the same httpOnly cookie the REST API uses — no token
 * handling in client code. Reconnects with exponential backoff and
 * re-subscribes to every room that was active before the drop, so a flaky
 * connection is invisible to the rest of the UI beyond a brief gap.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private rooms = new Set<string>();
  private backoffMs = 500;
  private manuallyClosed = false;

  connect() {
    this.manuallyClosed = false;
    this.socket = new WebSocket(`${WS_URL}/ws`);

    this.socket.onopen = () => {
      this.backoffMs = 500;
      for (const roomId of this.rooms) this.send({ type: "subscribe", roomId });
    };

    this.socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as RealtimeEvent;
        for (const listener of this.listeners) listener(parsed);
      } catch {
        // ignore malformed frames
      }
    };

    this.socket.onclose = () => {
      if (this.manuallyClosed) return;
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    };
  }

  disconnect() {
    this.manuallyClosed = true;
    this.socket?.close();
  }

  subscribe(roomId: string) {
    this.rooms.add(roomId);
    this.send({ type: "subscribe", roomId });
  }

  unsubscribe(roomId: string) {
    this.rooms.delete(roomId);
    this.send({ type: "unsubscribe", roomId });
  }

  sendTyping(roomId: string, isTyping: boolean) {
    this.send({ type: "typing", roomId, isTyping });
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

export const realtime = new RealtimeClient();
