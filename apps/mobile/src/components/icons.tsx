/** UI icons: Lucide (ISC, see README "ライセンス・商標"), imported one file each so Metro bundles only these. */
import type { LucideProps } from "lucide-react-native";
import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowLeftRight from "lucide-react-native/icons/arrow-left-right";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import Bell from "lucide-react-native/icons/bell";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleStop from "lucide-react-native/icons/circle-stop";
import Clock from "lucide-react-native/icons/clock";
import Copy from "lucide-react-native/icons/copy";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import ExternalLink from "lucide-react-native/icons/external-link";
import Laptop from "lucide-react-native/icons/laptop";
import Layers from "lucide-react-native/icons/layers";
import Lightbulb from "lucide-react-native/icons/lightbulb";
import Menu from "lucide-react-native/icons/menu";
import Monitor from "lucide-react-native/icons/monitor";
import Pencil from "lucide-react-native/icons/pencil";
import Plus from "lucide-react-native/icons/plus";
import Reply from "lucide-react-native/icons/reply";
import Search from "lucide-react-native/icons/search";
import Server from "lucide-react-native/icons/server";
import Settings from "lucide-react-native/icons/settings";
import Share from "lucide-react-native/icons/share";
import Smartphone from "lucide-react-native/icons/smartphone";
import SquareTerminal from "lucide-react-native/icons/square-terminal";
import Star from "lucide-react-native/icons/star";
import WifiOff from "lucide-react-native/icons/wifi-off";
import X from "lucide-react-native/icons/x";
import type { ComponentType } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useAppearance } from "@/theme/appearance";

interface IconProps {
	size?: number;
	color?: string;
	strokeWidth?: number;
}

/** A Lucide icon with this app's default size, theme color and stroke; props still override each. */
function icon(
	Icon: ComponentType<LucideProps>,
	size: number,
	defaultColor: "text" | "textSecondary" | "textCode" | "accent" | "statusFailedText" = "text",
	strokeWidth = 2,
) {
	return ({ size: s = size, color, strokeWidth: w = strokeWidth }: IconProps) => {
		const { colors } = useAppearance();
		return <Icon size={s} color={color ?? colors[defaultColor]} strokeWidth={w} />;
	};
}

export const MenuIcon = icon(Menu, 22, "text", 1.9);
export const ArrowUpIcon = icon(ArrowUp, 18, "text", 2.2);
export const ArrowDownIcon = icon(ArrowDown, 18, "text", 2.2);
export const ChevronDownIcon = icon(ChevronDown, 14);
export const ChevronUpIcon = icon(ChevronUp, 14);
export const ChevronRightIcon = icon(ChevronRight, 16);
export const BackIcon = icon(ChevronLeft, 22);
export const CloseIcon = icon(X, 22);
export const PlusIcon = icon(Plus, 16, "text", 2.2);
export const BulbIcon = icon(Lightbulb, 13);
export const BellIcon = icon(Bell, 14);
export const SwapIcon = icon(ArrowLeftRight, 14);
/** "Send after the current turn" (queued follow-up). */
export const QueuedIcon = icon(Reply, 14);
export const WifiOffIcon = icon(WifiOff, 15);
export const SearchIcon = icon(Search, 16, "textSecondary");
export const ClockIcon = icon(Clock, 12, "textSecondary");
export const AlertIcon = icon(CircleAlert, 16, "statusFailedText");
/** Opens outside the app (store, browser). */
export const ExternalIcon = icon(ExternalLink, 14);
export const ShareIcon = icon(Share, 16);
export const GearIcon = icon(Settings, 18, "textSecondary", 1.8);
export const ServerIcon = icon(Server, 15, "textSecondary", 1.9);
export const LaptopIcon = icon(Laptop, 15, "textSecondary", 1.9);
/** This phone (first-connection drawings). */
export const PhoneIcon = icon(Smartphone, 20, "textCode", 1.9);
export const MoreIcon = icon(Ellipsis, 20);
export const CopyIcon = icon(Copy, 18, "text", 1.9);
export const TerminalIcon = icon(SquareTerminal, 16, "text", 1.9);
export const CheckIcon = icon(Check, 18, "accent", 2.4);
export const PencilIcon = icon(Pencil, 22, "text", 1.9);
/** Context: stacked layers, the shape that still reads at 12px inside the composer gauge (Issue #138). */
export const ContextIcon = icon(Layers, 12, "text", 2.2);

/** A PC running the Host (drawer host headers): filled, to weigh the same as the Grok Bot mark. One for every OS. */
export const MonitorIcon = ({ size = 14, color }: IconProps) => {
	const { colors } = useAppearance();
	const c = color ?? colors.textSecondary;
	return <Monitor size={size} color={c} fill={c} strokeWidth={2} />;
};
/** Stop the turn: the square is filled so the button reads at a glance. */
export const StopIcon = ({ size = 22, color }: IconProps) => {
	const { colors } = useAppearance();
	const c = color ?? colors.text;
	return (
		<CircleStop size={size} color={c} strokeWidth={1.8}>
			<Rect x={9} y={9} width={6} height={6} rx={1} fill={c} />
		</CircleStop>
	);
};
/** Favorite model (Pi's scoped models): outline, filled when on. */
export const StarIcon = ({ size = 20, color, filled }: IconProps & { filled?: boolean }) => {
	const { colors } = useAppearance();
	const c = color ?? colors.textSecondary;
	return <Star size={size} color={c} fill={filled ? c : "none"} strokeWidth={1.8} />;
};

// Brand marks: unmodified shapes (simple-icons 16.35.0 traces of the official logos), used only to label which
// provider an allowance belongs to. Trademarks of Anthropic / OpenAI; see README "商標".
const CLAUDE_MARK =
	"m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";
const OPENAI_MARK =
	"M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";
/** Claude mark in its own brand color (never recolored). */
export const ClaudeLogo = ({ size = 12 }: { size?: number }) => (
	<Svg width={size} height={size} viewBox="0 0 24 24">
		<Path d={CLAUDE_MARK} fill="#D97757" />
	</Svg>
);
/** OpenAI Blossom: monochrome only (black or white). */
export const OpenAILogo = ({ size = 12 }: { size?: number }) => {
	const { colors } = useAppearance();
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24">
			<Path d={OPENAI_MARK} fill={colors.text} />
		</Svg>
	);
};

// GitHub Invertocat (simple-icons 16.35.0), unmodified; trademark of GitHub, Inc., labels the link to the repo only.
const GITHUB_MARK =
	"M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";
/** GitHub mark: monochrome only (black or white). */
export const GitHubLogo = ({ size = 20 }: { size?: number }) => {
	const { colors } = useAppearance();
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24">
			<Path d={GITHUB_MARK} fill={colors.text} />
		</Svg>
	);
};

// Grok Bot mascot (eyes cut out by evenodd) from @lobehub/icons-rn 2.21.0 GrokBot Mono, MIT © 2023 LobeHub.
// Trademark of xAI; labels Pi started by Grok Bot only. See README "商標".
const GROK_BOT_MARK =
	"M 21.675 8.364 C 22.181 9.711 22.401 11.160 22.318 12.596 C 22.240 13.947 21.893 15.281 21.305 16.500 C 19.286 20.674 14.707 23.000 10.145 22.167 C 9.064 21.970 8.015 21.599 7.049 21.073 C 6.010 20.506 5.070 19.758 4.283 18.874 C 3.438 17.927 2.772 16.824 2.325 15.636 C 1.819 14.289 1.599 12.840 1.682 11.404 C 1.760 10.053 2.107 8.719 2.695 7.500 C 4.714 3.326 9.293 1.000 13.855 1.833 C 14.936 2.030 15.985 2.401 16.951 2.927 C 17.990 3.494 18.930 4.242 19.717 5.126 C 20.562 6.073 21.228 7.177 21.675 8.364 Z M 12.012 6.137 L 12.309 6.139 L 12.599 6.198 L 12.871 6.314 L 13.114 6.485 L 13.310 6.706 L 13.490 6.943 L 13.665 7.183 L 13.838 7.423 L 14.010 7.666 L 14.178 7.911 L 14.344 8.157 L 14.509 8.405 L 14.670 8.653 L 14.830 8.903 L 14.986 9.155 L 15.124 9.418 L 15.206 9.703 L 15.222 9.998 L 15.171 10.290 L 15.052 10.562 L 14.872 10.797 L 14.641 10.982 L 14.374 11.108 L 14.083 11.168 L 13.787 11.160 L 13.500 11.086 L 13.235 10.954 L 13.003 10.767 L 12.817 10.537 L 12.659 10.287 L 12.497 10.037 L 12.334 9.790 L 12.170 9.542 L 12.003 9.296 L 11.837 9.051 L 11.667 8.807 L 11.495 8.565 L 11.322 8.323 L 11.148 8.084 L 10.978 7.839 L 10.869 7.565 L 10.839 7.271 L 10.890 6.979 L 11.016 6.712 L 11.209 6.486 L 11.449 6.312 L 11.721 6.195 Z M 16.385 4.055 L 16.653 4.082 L 16.911 4.159 L 17.157 4.272 L 17.386 4.412 L 17.600 4.576 L 17.793 4.764 L 17.972 4.967 L 18.144 5.175 L 18.313 5.386 L 18.475 5.601 L 18.633 5.818 L 18.787 6.041 L 18.934 6.267 L 19.077 6.495 L 19.214 6.728 L 19.347 6.963 L 19.474 7.200 L 19.594 7.441 L 19.685 7.696 L 19.736 7.960 L 19.734 8.229 L 19.659 8.486 L 19.488 8.692 L 19.239 8.788 L 18.971 8.769 L 18.720 8.673 L 18.494 8.528 L 18.293 8.347 L 18.119 8.141 L 17.972 7.915 L 17.846 7.677 L 17.716 7.442 L 17.582 7.206 L 17.442 6.976 L 17.298 6.748 L 17.150 6.523 L 16.997 6.300 L 16.838 6.083 L 16.676 5.868 L 16.508 5.655 L 16.336 5.449 L 16.158 5.245 L 16.001 5.026 L 15.884 4.783 L 15.837 4.519 L 15.911 4.264 L 16.121 4.101 Z";
/** Grok Bot mark: monochrome only (black or white). */
export const GrokBotLogo = ({ size = 14 }: { size?: number }) => {
	const { colors } = useAppearance();
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24">
			<Path d={GROK_BOT_MARK} fill={colors.text} fillRule="evenodd" />
		</Svg>
	);
};

/** Ring filled by `percent`; null = unknown, drawn dotted so it never reads as 0%. */
export function RingIcon({ percent, color, size = 24 }: { percent: number | null; color: string; size?: number }) {
	const { colors } = useAppearance();
	const c = 2 * Math.PI * 10.5;
	const filled = ((percent === null ? 0 : Math.max(0, Math.min(100, percent))) / 100) * c;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Circle
				cx={12}
				cy={12}
				r={10.5}
				stroke={percent === null ? colors.textTertiary : colors.surfaceStrong}
				strokeWidth={2}
				strokeDasharray={percent === null ? "1.5 3" : undefined}
			/>
			{filled > 0 ? (
				<Circle
					cx={12}
					cy={12}
					r={10.5}
					stroke={color}
					strokeWidth={2}
					strokeDasharray={`${filled} ${c}`}
					strokeLinecap="round"
					transform="rotate(-90 12 12)"
				/>
			) : null}
		</Svg>
	);
}
