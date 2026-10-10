type Handler<T> = (payload: T) => void;

/** Minimal typed event bus used for communication between player modules. */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        (h as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`[MVPlayer] handler for "${String(event)}" failed`, err);
      }
    });
  }

  clear(): void {
    this.handlers.clear();
  }
}
