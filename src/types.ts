export interface ReaderDocument {
  id: string;
  name: string;
  content: string;
  path?: string;
  openedAt: number;
  origin: 'sample' | 'local' | 'paste';
}

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export interface Diagram {
  id: string;
  source: string;
}

export interface CompiledDocument {
  html: string;
  headings: Heading[];
  diagrams: Diagram[];
  characters: number;
  lines: number;
}

export type Theme = 'light' | 'dark';
export type ViewMode = 'preview' | 'source' | 'wysiwyg';
