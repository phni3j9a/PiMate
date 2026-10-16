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

import { pickImage } from "../src/lib/pickImage";

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
	it("uses the OS single-photo picker, bounds dimensions and converts to JPEG", async () => {
		expect(await pickImage()).toEqual({ type: "image", mimeType: "image/jpeg", data: "YQ==" });
		expect(native.pick).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsMultipleSelection: false });
		expect(native.resize).toHaveBeenCalledWith({ width: 1600 });
		expect(native.save).toHaveBeenCalledWith({ format: "jpeg", compress: 0.85, base64: true });
		expect(native.releaseImage).toHaveBeenCalledOnce();
		expect(native.releaseContext).toHaveBeenCalledOnce();
	});
	it("treats cancellation as no change", async () => {
		native.pick.mockResolvedValue({ canceled: true, assets: null });
		expect(await pickImage()).toBeNull();
		expect(native.manipulate).not.toHaveBeenCalled();
	});
	it.each([
		[900, 1800, { height: 1600 }],
		[800, 600, null],
	])("only shrinks the longest edge (%s x %s)", async (width, height, size) => {
		native.pick.mockResolvedValue({ canceled: false, assets: [{ uri: "photo", width, height }] });
		await pickImage();
		if (size) expect(native.resize).toHaveBeenCalledWith(size);
		else expect(native.resize).not.toHaveBeenCalled();
	});
	it("rejects oversized encoded output and releases native allocations", async () => {
		native.save.mockResolvedValue({ base64: Buffer.alloc(512 * 1024 + 1).toString("base64") });
		await expect(pickImage()).rejects.toThrow("512 KiB");
		expect(native.releaseImage).toHaveBeenCalledOnce();
		expect(native.releaseContext).toHaveBeenCalledOnce();
	});
	it("releases the context when decoding fails", async () => {
		native.render.mockRejectedValue(new Error("decode failed"));
		await expect(pickImage()).rejects.toThrow("decode failed");
		expect(native.releaseContext).toHaveBeenCalledOnce();
	});
	it("releases both native references when saving fails", async () => {
		native.save.mockRejectedValue(new Error("save failed"));
		await expect(pickImage()).rejects.toThrow("save failed");
		expect(native.releaseImage).toHaveBeenCalledOnce();
		expect(native.releaseContext).toHaveBeenCalledOnce();
	});
});
