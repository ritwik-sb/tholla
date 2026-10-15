export type Engine = 'webspeech' | 'kokoro'

export interface Book {
  id: string
  name: string
  text: string
  chapters: string[]
  createdAt: number
}
