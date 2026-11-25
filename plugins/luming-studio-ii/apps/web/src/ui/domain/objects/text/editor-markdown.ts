import type { Line, Marks, Run } from './editor-model.js';
import { parseInlineText } from './rich-text.js';

export function markdownLines(value: string): Line[] {
  return value.split(/\r?\n/).map((text) => {
    const list = /^( *)(?:([-*]) |(\d+)\. )(.*)$/.exec(text);
    const body = list ? list[4]! : text;
    const listKind = list?.[3] ? 'ordered' : 'bullet';
    return {
      list: list ? listKind : undefined,
      level: list ? Math.floor(list[1]!.length / 2) : 0,
      order: list?.[3] ? Number(list[3]) : undefined,
      runs: parseInlineText(body).map((segment) => ({
        text: segment.text,
        bold: segment.bold || segment.type === 'bold',
        italic: segment.italic || segment.type === 'italic',
        code: segment.code || segment.type === 'code',
        href: segment.href,
      })),
    };
  });
}

function serializeRuns(input: Run[]): string {
  const runs = input.filter((run) => run.text);
  if (!runs.length) {
    return '';
  }

  const keys: (keyof Marks)[] = ['href', 'bold', 'italic', 'code'];
  const same = (a: Run, b: Run, key: keyof Marks) =>
    key === 'href' ? a.href === b.href : !!a[key] === !!b[key];
  const shared = keys.find((key) => runs[0]![key] && runs.every((run) => same(run, runs[0]!, key)));
  const wrap = (key: keyof Marks, contents: Run[]) => {
    if (key === 'code') {
      return `\`${contents.map((run) => run.text).join('')}\``;
    }

    const unmarked = contents.map((run) => {
      const next = { ...run };
      delete next[key];
      return next;
    });
    const text = serializeRuns(unmarked);
    if (key === 'href') {
      const href = contents[0]!.href!.replace(/\(/g, '%28').replace(/\)/g, '%29');
      return `[${text}](${href})`;
    }
    return key === 'bold' ? `**${text}**` : `_${text}_`;
  };

  if (shared) {
    return wrap(shared, runs);
  }

  let key: keyof Marks | undefined;
  let count = 0;
  for (const candidate of keys) {
    if (!runs[0]![candidate]) {
      continue;
    }

    let length = 1;
    while (length < runs.length && same(runs[length]!, runs[0]!, candidate)) {
      length++;
    }
    if (length > count) {
      key = candidate;
      count = length;
    }
  }
  if (key) {
    return wrap(key, runs.slice(0, count)) + serializeRuns(runs.slice(count));
  }

  return runs[0]!.text.replace(/([\\*_`[\]])/g, '\\$1') + serializeRuns(runs.slice(1));
}

export function serialize(lines: Line[], singleLine = false): string {
  const counters = new Map<number, number>();
  const value = lines
    .map((line, index) => {
      const runs: Run[] = [];
      for (const run of line.runs) {
        const previous = runs.at(-1);
        const sameEmphasis =
          previous && !!previous.bold === !!run.bold && !!previous.italic === !!run.italic;

        if (sameEmphasis && !!previous.code === !!run.code && previous.href === run.href) {
          previous.text += run.text;
        } else {
          runs.push({ ...run });
        }
      }
      const body = serializeRuns(runs);
      const previous = lines[index - 1];
      const inOrderedSequence =
        line.list === 'ordered' && previous?.list && previous.level >= line.level;
      const order =
        inOrderedSequence && counters.has(line.level)
          ? counters.get(line.level)! + 1
          : (line.order ?? 1);

      if (line.list === 'ordered') {
        counters.set(line.level, order);
      } else if (line.list) {
        counters.delete(line.level);
      } else {
        counters.clear();
      }
      return `${line.list ? '  '.repeat(line.level) + (line.list === 'ordered' ? `${order}. ` : '- ') : ''}${body}`;
    })
    .join('\n');

  return singleLine ? value.replace(/\n/g, ' ') : value;
}
