import { describe, expect, it } from "vitest";
import { formatPairingLink, parsePairingLink } from "../src/index.ts";

describe("pairing link", () => {
	const link = {
		address: "100.90.41.53:47800",
		code: "AbCdEfGhIjKlMnOpQrStUv",
		hostName: "server Mac&mini",
		hostId: "h1",
	};
	it("round-trips", () => {
		expect(parsePairingLink(formatPairingLink(link))).toEqual(link);
	});
	it("accepts bracketed IPv6 and MagicDNS names", () => {
		for (const address of ["[fd7a:115c:a1e0::1]:47800", "server-macmini.tail1234.ts.net:47800"]) {
			expect(parsePairingLink(formatPairingLink({ ...link, address }))?.address).toBe(address);
		}
	});
	it("rejects other links and bad fields", () => {
		expect(parsePairingLink("https://example.com")).toBeNull();
		expect(parsePairingLink("pimate://pair?h=x:1&c=short&id=h")).toBeNull();
		expect(parsePairingLink("pimate://pair?h=bad host:1&c=AbCdEfGhIjKlMnOpQrStUv&id=h")).toBeNull();
		expect(parsePairingLink("pimate://pair?c=AbCdEfGhIjKlMnOpQrStUv&id=h")).toBeNull();
	});
});
