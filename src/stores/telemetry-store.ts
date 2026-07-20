import { create } from 'zustand'
import type { TelemetryMessage } from '../schemas/telemetry'

type ConnectionState = 'connected' | 'connecting' | 'disconnected'

type TelemetryStore = {
  connection: ConnectionState
  latestMessage: TelemetryMessage | null
  setConnection: (connection: ConnectionState) => void
  setLatestMessage: (message: TelemetryMessage) => void
}

export const useTelemetryStore = create<TelemetryStore>((set) => ({
  connection: 'connected',
  latestMessage: null,
  setConnection: (connection) => set({ connection }),
  setLatestMessage: (latestMessage) => set({ latestMessage }),
}))
