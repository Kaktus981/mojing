import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  bounds: WindowBounds
  maximized: boolean
}

export function parseWindowState(value: unknown): WindowState | null {
  if (!value || typeof value !== 'object' || !('bounds' in value) || !('maximized' in value)) return null
  const { bounds, maximized } = value
  if (!bounds || typeof bounds !== 'object' || typeof maximized !== 'boolean') return null
  if (!('x' in bounds) || !('y' in bounds) || !('width' in bounds) || !('height' in bounds)) return null
  const { x, y, width, height } = bounds
  if (typeof x !== 'number' || !Number.isInteger(x) || typeof y !== 'number' || !Number.isInteger(y) ||
      typeof width !== 'number' || !Number.isInteger(width) || typeof height !== 'number' || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null
  return { bounds: { x, y, width, height }, maximized }
}

export function placeWindow(saved: WindowState | null, workAreas: WindowBounds[], currentWorkArea: WindowBounds): WindowState {
  const old = saved?.bounds
  const overlap = (candidate: WindowBounds): number => old
    ? Math.max(0, Math.min(old.x + old.width, candidate.x + candidate.width) - Math.max(old.x, candidate.x)) *
      Math.max(0, Math.min(old.y + old.height, candidate.y + candidate.height) - Math.max(old.y, candidate.y))
    : 0
  let area: WindowBounds | undefined
  let largestOverlap = 0
  for (const candidate of workAreas) {
    const size = overlap(candidate)
    if (size > largestOverlap) {
      area = candidate
      largestOverlap = size
    }
  }
  const target = area ?? currentWorkArea
  const width = Math.min(old?.width ?? 1500, target.width)
  const height = Math.min(old?.height ?? 940, target.height)
  const x = area && old ? Math.max(target.x, Math.min(old.x, target.x + target.width - width)) : target.x + Math.floor((target.width - width) / 2)
  const y = area && old ? Math.max(target.y, Math.min(old.y, target.y + target.height - height)) : target.y + Math.floor((target.height - height) / 2)
  return { bounds: { x, y, width, height }, maximized: saved?.maximized ?? true }
}

export function loadWindowState(userData: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(join(userData, 'window-state.json'), 'utf8')))
  } catch {
    return null
  }
}

export function saveWindowState(userData: string, state: WindowState): void {
  writeFileSync(join(userData, 'window-state.json'), JSON.stringify(state), 'utf8')
}
