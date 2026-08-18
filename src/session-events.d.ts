/**
 * Plugin-merged session event vocabulary. The `message-edit/version` event is
 * appended by this plugin's branch transaction and read back by the lineage
 * projection; declaring it here keeps the base SessionEvent union honest.
 */
import type { MessageEditVersionEvent } from './shared.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'message-edit/version': MessageEditVersionEvent
  }
}
