/** A toast. Not an API type: the error ones carry the errorCode of an ApiError as their `code`. */
export interface AppMessage {
  id: number;
  type: 'error' | 'success' | 'info' | 'warning';
  /** Rendered as MESSAGES.<TYPE>.<code>. */
  code: string;
  status?: number;
  params?: Record<string, unknown>;
  /**
   * The session warning's window, epoch ms. Both ends are needed: `to` ticks the mm:ss, and the span
   * between them is the progress bar's duration - recomputing that every second would restart the
   * animation on every tick.
   */
  countdownFrom?: number;
  countdownTo?: number;
}
