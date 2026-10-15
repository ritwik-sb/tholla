export type Engine = 'webspeech' | 'kokoro'

export interface Chapter {
  title: string
  text: string
}

export interface Book {
  id: string
  name: string
  text: string
  chapters: Chapter[]
  createdAt: number
}
