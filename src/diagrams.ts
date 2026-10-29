import { sanitizeDiagramSvg } from './svg';
import { renderInSandbox } from './diagram-sandbox';
import type { Diagram, Theme } from './types';

let sequence = 0;
let queue = Promise.resolve();

/** Preview and exports share one queue: Mermaid's global theme is not reentrant. */
export function renderDiagramSvg(source: string, theme: Theme): Promise<string> {
  const work = async () => {
    if (source.length > 50000) throw new Error('図が大きすぎます（最大50,000文字）。');
    const svg = await renderInSandbox(++sequence, source, theme);
    return sanitizeDiagramSvg(svg);
  };
  const result = queue.then(work, work);
  queue = result.then(() => {}, () => {});
  return result;
}

export async function renderDiagrams(container: HTMLElement, diagrams: Diagram[], theme: Theme, isCurrent: () => boolean): Promise<void> {
    for (const diagram of diagrams) {
      if (!isCurrent()) return;
      const element = container.querySelector<HTMLElement>(`[data-diagram="${diagram.id}"] .diagram-content`);
      if (!element) continue;
      try {
        const svg = await renderDiagramSvg(diagram.source, theme);
        if (!isCurrent()) return;
        element.innerHTML = svg;
      } catch (error) {
        if (!isCurrent()) return;
        element.replaceChildren();
        const heading = document.createElement('p');
        heading.className = 'diagram-error';
        heading.textContent = 'この図を描画できませんでした';
        const detail = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'エラーと記法を確認';
        const code = document.createElement('pre');
        code.textContent = `${error instanceof Error ? error.message.slice(0, 600) : 'Mermaidの構文を確認してください。'}\n\n${diagram.source}`;
        detail.append(summary, code);
        element.append(heading, detail);
      }
    }
}
