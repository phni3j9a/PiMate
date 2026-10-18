import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	pick: vi.fn(),
	manipulate: vi.fn(),
	resize: vi.fn(),
	render: vi.fn(),
	save: vi.fn(),
	releaseContext: vi.fn(),
	releaseImage: vi.fn(),
}));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: native.pick }));
vi.mock("expo-image-manipulator", () => ({
	ImageManipulator: { manipulate: native.manipulate },
	SaveFormat: { JPEG: "jpeg" },
}));

import { pickImages } from "../src/lib/pickImage";

beforeEach(() => {
	vi.resetAllMocks();
	native.pick.mockResolvedValue({
		canceled: false,
		assets: [{ uri: "file:///photo.heic", width: 3200, height: 2400 }],
	});
	native.manipulate.mockReturnValue({
		resize: native.resize,
		renderAsync: native.render,
		release: native.releaseContext,
	});
	native.render.mockResolvedValue({ saveAsync: native.save, release: native.releaseImage });
	native.save.mockResolvedValue({ base64: "YQ==" });
});
describe("system photo picker", () => {
	it("uses the OS multi-photo picker, bounds dimensions and converts to JPEG", async () => {
		expect(await pickImages([], 4)).toEqual([{ type: "image", mimeType: "image/jpeg", data: "YQ==" }]);
		expect(native.pick).toHaveBeenCalledWith({
			mediaTypes: ["images"],
			allowsMultipleSelection: true,
			selectionLimit: 4,
		});
		expect(native.resize).toHaveBeenCalledWith({ width: 1600 });
		expect(native.save).toHaveBeenCalledWith({ format: "jpeg", compress: 0.85, base64: true });
		expect(native.releaseImage).toHaveBeenCalledOnce();
		expect(native.releaseContext).toHaveBeenCalledOnce();
	});
	it("treats cancellation as no change", async () => {
		native.pick.mockResolvedValue({ canceled: true, assets: null });
		expect(await pickImages([], 4)).toBeNull();
		expect(native.manipulate).not.toHaveBeenCalled();
	});
	it.each([
		[900, 1800, { height: 1600 }],
		[800, 600, null],
	])("only shrinks the longest edge (%s x %s)", async (width, height, size) => {
		native.pick.mockResolvedValue({ canceled: false, assets: [{ uri: "photo", width, height }] });
		await pickImages([], 4);
		if (size) expect(native.resize).toHaveBeenCalledWith(size);
		else expect(native.resize).not.toHaveBeenCalled();
	});
	it("rejects oversized encoded output and releases native allocations", async () => {
		native.save.mockResolvedValue({ base64: Buffer.alloc(512 * 1024 + 1).toString("base64") });
		await expect(pickImages([], 4)).rejects.toThrow("512 KiB");
		expect(native.releaseImage).toHaveBeenCalledTimes(5);
		expect(native.releaseContext).toHaveBeenCalledTimes(5);
	});
	it("releases the context when decoding fails", async () => {
		native.render.mockRejectedValue(new Error("decode failed"));
		await expect(pickImages([], 4)).rejects.toThrow("decode failed");
		expect(native.releaseContext).toHaveBeenCalledOnce();
	});
	it("releases both native references when saving fails", async () => {
		native.save.mockRejectedValue(new Error("save failed"));
		await expect(pickImages([], 4)).rejects.toThrow("save failed");
		expect(native.releaseImage).toHaveBeenCalledOnce();
		expect(native.releaseContext).toHaveBeenCalledOnce();
	});
});

it("adds multiple photos with the remaining selection limit and leaves existing bytes unchanged", async () => {
	const existing = { type: "image", mimeType: "image/png", data: "Yg==" } as const;
	native.pick.mockResolvedValue({
		canceled: false,
		assets: Array(3).fill({ uri: "photo", width: 1600, height: 1200 }),
	});
	const result = await pickImages([existing], 4);
	expect(native.pick).toHaveBeenCalledWith(expect.objectContaining({ selectionLimit: 3 }));
	expect(result).toHaveLength(4);
	expect(result?.[0]).toBe(existing);
	expect(native.releaseImage).toHaveBeenCalledTimes(3);
});

it("compresses harder until each new image fits its share of the total budget", async () => {
	native.pick.mockResolvedValue({
		canceled: false,
		assets: Array(4).fill({ uri: "photo", width: 3200, height: 2400 }),
	});
	native.save.mockResolvedValue({ base64: Buffer.alloc(150 * 1024).toString("base64") });
	native.save.mockResolvedValueOnce({ base64: Buffer.alloc(151 * 1024).toString("base64") });
	const result = await pickImages([], 4);
	expect(result).toHaveLength(4);
	expect(native.save).toHaveBeenNthCalledWith(2, { format: "jpeg", compress: 0.7, base64: true });
	expect(native.resize).toHaveBeenCalledWith({ width: 1200 });
	expect(native.releaseImage).toHaveBeenCalledTimes(5);
	expect(native.releaseContext).toHaveBeenCalledTimes(5);
});

it("rejects full attachment sets and picker results over the RC limit without changing the draft", async () => {
	const existing = { type: "image", mimeType: "image/png", data: "YQ==" } as const;
	await expect(pickImages([existing], 1)).rejects.toThrow("1枚まで");
	expect(native.pick).not.toHaveBeenCalled();
	native.pick.mockResolvedValue({ canceled: false, assets: Array(2).fill({ uri: "photo", width: 100, height: 100 }) });
	await expect(pickImages([], 1)).rejects.toThrow("1枚まで");
	expect(native.manipulate).not.toHaveBeenCalled();
});
