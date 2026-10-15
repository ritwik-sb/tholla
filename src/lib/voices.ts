export type HairStyle = 'short' | 'spiky' | 'long' | 'bob' | 'bun' | 'curly' | 'bald'
export type Accessory =
  | 'none' | 'glasses' | 'santa' | 'beard' | 'headphones' | 'crown'
  | 'wolf' | 'elf' | 'bow' | 'heart' | 'tophat' | 'star'

export interface VoiceCharacter {
  id: string
  name: string
  accent: 'American' | 'British'
  gender: 'Female' | 'Male'
  bg: string
  skin: string
  hair: string
  style: HairStyle
  accessory: Accessory
}

const v = (
  id: string, name: string, bg: string, skin: string, hair: string,
  style: HairStyle, accessory: Accessory = 'none'
): VoiceCharacter => ({
  id, name, bg, skin, hair, style, accessory,
  accent: id[0] === 'b' ? 'British' : 'American',
  gender: id[1] === 'f' ? 'Female' : 'Male',
})

export const VOICES: VoiceCharacter[] = [
  v('af_heart', 'Heart', '#f43f5e', '#f1c7a6', '#7c2d12', 'long', 'heart'),
  v('af_bella', 'Bella', '#a855f7', '#e8b896', '#1c1917', 'curly', 'bow'),
  v('af_nicole', 'Nicole', '#14b8a6', '#f5d0b5', '#a16207', 'bob', 'headphones'),
  v('af_aoede', 'Aoede', '#6366f1', '#c68b6a', '#292524', 'bun', 'star'),
  v('af_kore', 'Kore', '#22c55e', '#f1c7a6', '#facc15', 'long'),
  v('af_sarah', 'Sarah', '#f97316', '#e3a982', '#78350f', 'bob', 'glasses'),
  v('af_nova', 'Nova', '#0ea5e9', '#8d5a3b', '#0f172a', 'curly', 'star'),
  v('af_sky', 'Sky', '#38bdf8', '#f5d0b5', '#e2e8f0', 'bun'),
  v('af_alloy', 'Alloy', '#64748b', '#d9a47f', '#334155', 'short', 'glasses'),
  v('af_jessica', 'Jessica', '#ec4899', '#f1c7a6', '#b91c1c', 'long'),
  v('af_river', 'River', '#06b6d4', '#a86e4c', '#3f2a1d', 'bob'),
  v('am_michael', 'Michael', '#3b82f6', '#f1c7a6', '#44403c', 'short'),
  v('am_fenrir', 'Fenrir', '#475569', '#d9a47f', '#9ca3af', 'spiky', 'wolf'),
  v('am_puck', 'Puck', '#84cc16', '#f5d0b5', '#ea580c', 'spiky', 'elf'),
  v('am_echo', 'Echo', '#8b5cf6', '#c68b6a', '#1e293b', 'short', 'headphones'),
  v('am_eric', 'Eric', '#0d9488', '#f1c7a6', '#a16207', 'short', 'glasses'),
  v('am_liam', 'Liam', '#f59e0b', '#e3a982', '#78350f', 'spiky'),
  v('am_onyx', 'Onyx', '#1e293b', '#6b4430', '#0a0a0a', 'bald', 'beard'),
  v('am_adam', 'Adam', '#10b981', '#f1c7a6', '#57534e', 'short', 'beard'),
  v('am_santa', 'Santa', '#dc2626', '#f5d0b5', '#f8fafc', 'bald', 'santa'),
  v('bf_emma', 'Emma', '#be185d', '#f5d0b5', '#92400e', 'bun', 'crown'),
  v('bf_isabella', 'Isabella', '#7c3aed', '#e8b896', '#1c1917', 'long', 'bow'),
  v('bf_alice', 'Alice', '#2563eb', '#f5d0b5', '#fde047', 'long', 'bow'),
  v('bf_lily', 'Lily', '#db2777', '#c68b6a', '#3f2a1d', 'curly'),
  v('bm_george', 'George', '#1d4ed8', '#f1c7a6', '#a8a29e', 'short', 'tophat'),
  v('bm_fable', 'Fable', '#9333ea', '#e3a982', '#713f12', 'curly', 'glasses'),
  v('bm_lewis', 'Lewis', '#0f766e', '#d9a47f', '#292524', 'short', 'beard'),
  v('bm_daniel', 'Daniel', '#b45309', '#f1c7a6', '#7c2d12', 'spiky', 'glasses'),
]

export const DEFAULT_VOICE = 'af_heart'

export const getVoice = (id: string) => VOICES.find(x => x.id === id) ?? VOICES[0]
