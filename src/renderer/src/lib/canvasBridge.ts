export interface CanvasCommands {
  fitView: () => void
  exportMap: (format: 'png' | 'svg' | 'pdf') => Promise<void>
}

let commands: CanvasCommands | null = null

export function registerCanvasCommands(next: CanvasCommands | null): void {
  commands = next
}

export function getCanvasCommands(): CanvasCommands | null {
  return commands
}
