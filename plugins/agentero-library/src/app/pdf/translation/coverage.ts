// Ported from motif (Copyright (c) 2026 poco-ai, MIT). See MOTIF-LICENSE.txt.
import { groupReadingLines } from "./reading-order";
import type { CharacterCoverage, CharacterDisposition } from "./types";
import { type Character, type Paragraph, unionBoxes } from "./types";
/** Use engine angles; retain a conservative fallback for older cached IR. */
export function rotatedCharacterIndexes(
	chars: readonly Character[],
): Set<number> {
	const rotated = new Set<number>();
	for (const c of chars)
		if (c.textAngle !== undefined && Math.abs(Math.sin(c.textAngle)) > 0.05)
			rotated.add(c.index);
	for (let i = 1; i < chars.length; i++) {
		const a = chars[i - 1],
			b = chars[i];
		if (a.textAngle !== undefined || b.textAngle !== undefined) continue;
		if (b.index !== a.index + 1 || !a.text.trim() || !b.text.trim()) continue;
		const dx = b.visualBox.x - a.visualBox.x,
			dy = b.visualBox.y - a.visualBox.y;
		if (
			Math.abs(dy) > Math.max(2, Math.abs(dx) * 2) &&
			Math.abs(dx) < 2 &&
			Math.abs(dy) < Math.max(a.visualBox.h, b.visualBox.h) * 2
		) {
			rotated.add(a.index);
			rotated.add(b.index);
		}
	}
	return rotated;
}

/** Split fallback lines at spatial gaps so separate plot labels never join. */
export function fallbackCharacterGroups(
	chars: readonly Character[],
): Character[][] {
	const groups: Character[][] = [];
	const objects = new Map<number, Character[]>();
	for (const c of chars) {
		const key = c.textObjectId ?? 0;
		const g = objects.get(key) ?? [];
		g.push(c);
		objects.set(key, g);
	}
	for (const object of objects.values()) {
		const bounds = unionBoxes(object.map((c) => c.box));
		const singleLine =
			object[0]?.textObjectId !== undefined &&
			bounds.h <= Math.max(...object.map((c) => c.style.size)) * 1.8;
		const lines = singleLine
			? [{ items: object }]
			: groupReadingLines(object, (c) => ({
					x: c.box.x,
					y: c.box.y,
					width: c.box.w,
					height: c.box.h,
				}));
		for (const line of lines) {
			let group: Character[] = [];
			for (const c of line.items.sort((a, b) => a.box.x - b.box.x)) {
				const prev = group.at(-1);
				if (
					prev &&
					c.box.x - prev.box.x - prev.box.w >
						Math.max(prev.style.size, c.style.size) * 1.2
				) {
					groups.push(group);
					group = [];
				}
				group.push(c);
			}
			if (group.length) groups.push(group);
		}
	}
	return groups.filter(
		(g) =>
			/\p{L}{2}/u.test(g.map((c) => c.text).join("")) &&
			unionBoxes(g.map((c) => c.visualBox)).h > 0,
	);
}

export function characterCoverage(
	chars: readonly Character[],
	paragraphs: readonly Paragraph[],
	preserved: ReadonlyMap<number, CharacterDisposition>,
): CharacterCoverage[] {
	const owners = new Map(
		paragraphs.flatMap((p) =>
			p.characters.map((c) => [c.index, p.id] as const),
		),
	);
	return chars
		.filter((c) => c.text.trim())
		.map((c) => ({
			index: c.index,
			text: c.text,
			disposition: owners.has(c.index)
				? "translated"
				: (preserved.get(c.index) ?? "unresolved"),
			paragraphId: owners.get(c.index),
		}));
}

/** Rendering observes inherited clipping that PDFium text extraction omits.
 * This is a conservative ink check, not reconstruction of the clipping path.
 */
export function nonPaintingCharacters(
	chars: readonly Character[],
	image: { width: number; height: number; data: Uint8ClampedArray },
	pageWidth: number,
	pageHeight: number,
): Set<number> {
	const groups = new Map<number, Character[]>();
	for (const c of chars)
		if (
			c.text.trim() &&
			(c.renderMode === 3 ||
				c.renderMode === 7 ||
				(c.textMatrix &&
					Math.abs(Math.hypot(c.textMatrix[0], c.textMatrix[1]) - 1) > 0.01))
		) {
			const id = c.textObjectId ?? c.index;
			const g = groups.get(id) ?? [];
			g.push(c);
			groups.set(id, g);
		}
	const hidden = new Set<number>();
	const sx = image.width / pageWidth,
		sy = image.height / pageHeight;
	for (const group of groups.values()) {
		let visible = 0;
		for (const c of group) {
			if (c.renderMode === 3 || c.renderMode === 7) continue;
			const b = c.visualBox;
			let ink = false;
			for (
				let y = Math.max(0, Math.floor(b.y * sy));
				y < Math.min(image.height, Math.ceil((b.y + b.h) * sy)) && !ink;
				y++
			)
				for (
					let x = Math.max(0, Math.floor(b.x * sx));
					x < Math.min(image.width, Math.ceil((b.x + b.w) * sx));
					x++
				) {
					const i = (y * image.width + x) * 4;
					if (
						Math.abs(image.data[i] - c.style.color.r) +
							Math.abs(image.data[i + 1] - c.style.color.g) +
							Math.abs(image.data[i + 2] - c.style.color.b) <
						600
					) {
						ink = true;
						break;
					}
				}
			if (ink) visible++;
		}
		if (visible < group.length * 0.8)
			for (const c of group) hidden.add(c.index);
	}
	return hidden;
}
