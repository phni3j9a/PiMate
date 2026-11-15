const { expo } = require("./app.json");

// Three decimal digits per component; stable releases only (0.1.0 -> 1000).
const parts = expo.version.split(".").map(Number);
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expo.version) || parts.some((part) => part > 999)) {
	throw new Error("Android releases require a major.minor.patch version (each component <= 999)");
}
const versionCode = parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2];
if (versionCode < 1 || versionCode > 2_100_000_000) throw new Error("Invalid Android versionCode");
const iosBuildNumber =
	(typeof process === "undefined" ? undefined : process.env.PIMATE_IOS_BUILD_NUMBER) ?? String(versionCode);
if (!/^\d+$/.test(iosBuildNumber)) throw new Error("Invalid iOS buildNumber");
const config = {
	...expo,
	android: { ...expo.android, versionCode },
};
if (expo.ios) config.ios = { ...expo.ios, buildNumber: iosBuildNumber };
module.exports = config;
