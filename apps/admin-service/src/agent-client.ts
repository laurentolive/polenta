/**
 * GH63 — client de l'agent hôte (socket Unix, design §5.6). Sprint 2 : agent pas encore livré, état
 * toujours `absent` ; les actions « agent » du catalogue répondent 503. Le vrai client (protocole
 * JSON par lignes, liste fermée d'actions) arrive au Sprint 3.
 */
import type { AgentState } from '@polenta/types'

export interface AgentClient {
  state(): AgentState
}

export const absentAgent: AgentClient = {
  state: () => 'absent',
}
