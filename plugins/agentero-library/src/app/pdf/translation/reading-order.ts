// Ported from motif (Copyright (c) 2026 poco-ai, MIT). See MOTIF-LICENSE.txt.
/**
 * Reading order for PDF text runs inside one layout box.
 *
 * A bolder or larger word sticks up, so its top is higher than the words
 * beside it, while the bottoms still share a baseline. Group by that bottom,
 * left to right, then the next line down.
 */

export type ReadingBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ReadingLine<T> = {
	items: T[];
	top: number;
	bottom: number;
};

function boxBottom(box: ReadingBox): number {
	return box.y + box.height;
}

/** Descenders and bold boxes shift the bottom by a fraction of the line, not a full line gap. */
function baselineTolerance(heightA: number, heightB: number): number {
	const positive = [heightA, heightB].filter((height) => height > 0);
	const height = positive.length
		? Math.min(...positive)
		: Math.max(heightA, heightB, 1);
	return Math.max(1.5, height * 0.45);
}

function median(values: readonly number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
	return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function groupReadingLines<T>(
	items: readonly T[],
	boxOf: (item: T) => ReadingBox,
): ReadingLine<T>[] {
	type Bucket = { items: T[]; bottoms: number[]; heights: number[] };
	const buckets: Bucket[] = [];
	const ordered = items.slice().sort((a, b) => {
		const left = boxOf(a);
		const right = boxOf(b);
		return boxBottom(left) - boxBottom(right) || left.x - right.x;
	});
	for (const item of ordered) {
		const box = boxOf(item);
		const bottom = boxBottom(box);
		let best: Bucket | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const bucket of buckets) {
			const distance = Math.abs(bottom - median(bucket.bottoms));
			const limit = baselineTolerance(box.height, median(bucket.heights));
			if (distance <= limit && distance < bestDistance) {
				best = bucket;
				bestDistance = distance;
			}
		}
		if (best) {
			best.items.push(item);
			best.bottoms.push(bottom);
			best.heights.push(box.height);
		} else {
			buckets.push({
				items: [item],
				bottoms: [bottom],
				heights: [box.height],
			});
		}
	}

	const lines = buckets.map((bucket) => {
		const lineItems = bucket.items
			.slice()
			.sort((a, b) => boxOf(a).x - boxOf(b).x || boxOf(a).y - boxOf(b).y);
		const boxes = lineItems.map(boxOf);
		return {
			items: lineItems,
			top: Math.min(...boxes.map((box) => box.y)),
			bottom: Math.max(...boxes.map(boxBottom)),
		};
	});
	lines.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
	return lines;
}

export function orderByReadingLine<T>(
	items: readonly T[],
	boxOf: (item: T) => ReadingBox,
): T[] {
	return groupReadingLines(items, boxOf).flatMap((line) => line.items);
}
