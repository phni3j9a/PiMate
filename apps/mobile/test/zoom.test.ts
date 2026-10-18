import { describe, expect, it } from "vitest";

import { fittedSize, maxOffset, zoomAround } from "../src/lib/zoom";

const box = { width: 400, height: 800 };

describe("image viewer zoom math", () => {
	it("fits the natural size inside the box (contain)", () => {
		expect(fittedSize(box, { width: 2000, height: 1000 })).toEqual({ width: 400, height: 200 });
		expect(fittedSize(box, { width: 100, height: 400 })).toEqual({ width: 200, height: 800 });
		expect(fittedSize(box, null)).toBe(box);
	});

	it("allows no pan until the zoomed content exceeds the box", () => {
		expect(maxOffset(200, 800, 1)).toBe(0);
		expect(maxOffset(200, 800, 4)).toBe(0);
		expect(maxOffset(400, 400, 2.5)).toBe(300);
	});

	it("keeps the focal point fixed while zooming", () => {
		// A point 100 right of center at 1x stays 100 right of center at 2.5x.
		const t = zoomAround(100, 0, 1, 2.5);
		expect(t + 2.5 * 100).toBe(100);
		// Zooming back to the start scale restores the translation.
		expect(zoomAround(100, t, 2.5, 1)).toBeCloseTo(0);
	});
});
