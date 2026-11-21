import { createHash } from 'node:crypto';

const MiB = 1024 * 1024;
const seedVersion = 'studio-capacity-v1';
const pixelAsset = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64',
);

export const capacityProfiles = {
  small: {
    elements: 100,
    contentBytes: MiB / 4,
    history: 40,
    html: 2,
    documents: 2,
    todos: 2,
    images: 2,
    online: 1,
    active: 1,
  },
  near: {
    elements: 2000,
    contentBytes: 7.5 * MiB,
    history: 200,
    html: 12,
    documents: 16,
    todos: 24,
    images: 24,
    online: 12,
    active: 6,
  },
  expanded: {
    elements: 4000,
    contentBytes: 15 * MiB,
    history: 200,
    html: 24,
    documents: 32,
    todos: 48,
    images: 48,
    online: 30,
    active: 10,
  },
};

function element(type, index) {
  return {
    id: `${type}-${index}`,
    type,
    x: (index % 40) * 220,
    y: Math.floor(index / 40) * 150,
    w: 200,
    h: 130,
    version: 1,
  };
}

function syntheticMarkup(length, ordinal) {
  const sections = [];
  let remaining = length;
  for (let section = 0; remaining; section++) {
    const sample = `<p>Record ${ordinal}-${section} - local synthetic source</p>`;
    if (sample.length > remaining) {
      sections.push(' '.repeat(remaining));
      break;
    }
    sections.push(sample);
    remaining -= sample.length;
  }
  return sections.join('');
}

export function makeCapacityFixture(name) {
  const profile = capacityProfiles[name];
  if (!profile) {
    throw new Error(`Unknown capacity fixture: ${name}`);
  }

  const artifactId = `${seedVersion}-${name}`;
  const content = { style: {}, elements: [] };
  const resources = [];
  for (const [type, count] of [
    ['html', profile.html],
    ['document', profile.documents],
    ['todo', profile.todos],
    ['image', profile.images],
  ]) {
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const unit = element(type, content.elements.length);
      if (type === 'html') {
        unit.html = `<article><h1>Synthetic section ${ordinal}</h1></article>`;
      }
      if (type === 'document') {
        unit.document = {
          schemaVersion: 1,
          blocks: [
            {
              id: `block-${ordinal}`,
              type: 'paragraph',
              props: {},
              content: [{ type: 'text', text: `Synthetic document ${ordinal}`, styles: {} }],
              children: [],
            },
          ],
        };
      }
      if (type === 'todo') {
        unit.data = {
          items: [{ id: `row-${ordinal}`, text: `Synthetic task ${ordinal}`, checked: false }],
        };
      }
      if (type === 'image') {
        const id = `asset-${ordinal}`;
        unit.src = `/assets/${artifactId}/${id}`;
        resources.push({
          id,
          filename: `${id}.png`,
          mimeType: 'image/png',
          size: pixelAsset.byteLength,
        });
      }
      content.elements.push(unit);
    }
  }
  while (content.elements.length < profile.elements) {
    const unit = element('text', content.elements.length);
    unit.text = `Synthetic note ${content.elements.length}`;
    content.elements.push(unit);
  }
  let remaining = profile.contentBytes - Buffer.byteLength(JSON.stringify(content));
  if (remaining < 0) {
    throw new Error(`Fixture metadata exceeds its byte target: ${name}`);
  }

  for (const [ordinal, unit] of content.elements.slice(0, profile.html).entries()) {
    const increment = Math.floor(remaining / (profile.html - ordinal));
    const closingTag = '</article>';
    unit.html =
      unit.html.slice(0, -closingTag.length) + syntheticMarkup(increment, ordinal) + closingTag;
    remaining -= increment;
  }
  const json = JSON.stringify(content);
  if (Buffer.byteLength(json) !== profile.contentBytes) {
    throw new Error(`Fixture byte count changed: ${name}`);
  }

  const digest = createHash('sha256').update(json).digest('hex');
  return {
    name,
    seedVersion,
    artifactId,
    profile,
    content,
    resources,
    resourceData: pixelAsset,
    digest,
    history: Array.from({ length: profile.history }, (_, index) => ({
      id: `version-${index + 1}`,
      revision: index + 1,
      contentRef: digest,
    })),
  };
}
