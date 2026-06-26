/**
 * Shared in-memory storage for simulation testing
 * This serves as a simple data store without database persistence
 */

import type { SimulationConversation, SimulationMessage } from '@/lib/types';

// In-memory storage for simulation data
export const simulations: SimulationConversation[] = [];
export const simulationMessages: Map<string, SimulationMessage[]> = new Map();

/**
 * Trim simulations array to max size to prevent memory overflow
 */
export function trimSimulations() {
  while (simulations.length > 200) {
    const oldest = simulations.pop();
    if (oldest) {
      simulationMessages.delete(oldest.id);
    }
  }
}
