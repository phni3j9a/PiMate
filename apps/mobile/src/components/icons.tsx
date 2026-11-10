/** Line icons transcribed from the design mock SVGs (docs/design/html/*.html, 24×24 viewBox). */
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useAppearance } from "@/theme/appearance";

interface IconProps {
	size?: number;
	color?: string;
	strokeWidth?: number;
}

function Line({ d, size = 22, color: inputColor, strokeWidth = 2 }: IconProps & { d: string }) {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.text;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
		</Svg>
	);
}

/** Drawer button: two left-aligned strokes. */
export const MenuIcon = (p: IconProps) => <Line d="M4 8h16M4 16h10" strokeWidth={1.9} size={22} {...p} />;
export const ArrowUpIcon = (p: IconProps) => <Line d="M12 19V5M6 11l6-6 6 6" strokeWidth={2.2} size={18} {...p} />;
export const ArrowDownIcon = (p: IconProps) => <Line d="M12 5v14M6 13l6 6 6-6" strokeWidth={2.2} size={18} {...p} />;
export const ChevronDownIcon = (p: IconProps) => <Line d="M6 9l6 6 6-6" size={14} {...p} />;
export const ChevronUpIcon = (p: IconProps) => <Line d="M6 15l6-6 6 6" size={14} {...p} />;
export const ChevronRightIcon = (p: IconProps) => <Line d="M9 6l6 6-6 6" size={16} {...p} />;
export const BackIcon = (p: IconProps) => <Line d="M15 5l-7 7 7 7" size={22} {...p} />;
export const CloseIcon = (p: IconProps) => <Line d="M6 6l12 12M18 6L6 18" size={22} {...p} />;
export const PlusIcon = (p: IconProps) => <Line d="M12 5v14M5 12h14" strokeWidth={2.2} size={16} {...p} />;
export const BulbIcon = (p: IconProps) => (
	<Line
		d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"
		size={13}
		{...p}
	/>
);
export const BellIcon = (p: IconProps) => (
	<Line d="M12 3a6 6 0 0 0-6 6c0 5-2 7-2 7h16s-2-2-2-7a6 6 0 0 0-6-6zM10 20a2 2 0 0 0 4 0" size={14} {...p} />
);
export const SwapIcon = (p: IconProps) => <Line d="M4 7h14l-3-3M20 17H6l3 3" size={14} {...p} />;
/** "Send after the current turn" (queued follow-up). */
export const QueuedIcon = (p: IconProps) => <Line d="M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 5 5v3" size={14} {...p} />;
export const WifiOffIcon = (p: IconProps) => (
	<Line
		d="M2 8.8a15 15 0 0 1 5-2.9M10.6 5.1A15 15 0 0 1 22 8.8M5 12.3a10 10 0 0 1 4.4-2.4M17.3 10.5a10 10 0 0 1 1.7 1.8M8.5 15.8a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18"
		size={15}
		{...p}
	/>
);
export const SearchIcon = ({ size = 16, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.textSecondary;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={2} />
			<Path d="M20 20l-4.2-4.2" stroke={color} strokeWidth={2} strokeLinecap="round" />
		</Svg>
	);
};
export const ClockIcon = ({ size = 12, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.textSecondary;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
			<Path d="M12 7v5l3 2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
		</Svg>
	);
};
export const AlertIcon = ({ size = 16, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.statusFailedText;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
			<Path d="M12 7.5v5.5M12 16.5h.01" stroke={color} strokeWidth={2} strokeLinecap="round" />
		</Svg>
	);
};
/** Opens outside the app (store, browser). */
export const ExternalIcon = (p: IconProps) => (
	<Line
		d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"
		size={14}
		{...p}
	/>
);
export const ShareIcon = (p: IconProps) => (
	<Line d="M12 15V4M8 8l4-4 4 4M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13" size={16} {...p} />
);
export const StopIcon = ({ size = 22, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.text;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
			<Rect x={9} y={9} width={6} height={6} rx={1} fill={color} />
		</Svg>
	);
};
export const GearIcon = ({ size = 18, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.textSecondary;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.8} />
			<Path
				d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"
				stroke={color}
				strokeWidth={1.8}
				strokeLinecap="round"
			/>
		</Svg>
	);
};
export const ServerIcon = ({ size = 15, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.textSecondary;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Rect x={3} y={4} width={18} height={7} rx={2} stroke={color} strokeWidth={1.9} />
			<Rect x={3} y={13} width={18} height={7} rx={2} stroke={color} strokeWidth={1.9} />
			<Path d="M7 7.5h.01M7 16.5h.01" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
		</Svg>
	);
};
export const LaptopIcon = ({ size = 15, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.textSecondary;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Rect x={4} y={5} width={16} height={11} rx={1.5} stroke={color} strokeWidth={1.9} />
			<Path d="M2 19h20" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
		</Svg>
	);
};
/** This phone (first-connection drawings). */
export const PhoneIcon = ({ size = 20, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.textCode;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Rect x={7} y={3} width={10} height={18} rx={2.5} stroke={color} strokeWidth={1.9} />
			<Path d="M11 18h2" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
		</Svg>
	);
};

export const MoreIcon = ({ size = 20, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.text;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
			<Circle cx={5} cy={12} r={1.6} />
			<Circle cx={12} cy={12} r={1.6} />
			<Circle cx={19} cy={12} r={1.6} />
		</Svg>
	);
};
export const CopyIcon = ({ size = 18, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.text;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9}>
			<Rect x={9} y={9} width={11} height={11} rx={2} strokeLinejoin="round" />
			<Path d="M5 15V6a2 2 0 0 1 2-2h9" strokeLinecap="round" strokeLinejoin="round" />
		</Svg>
	);
};
export const TerminalIcon = ({ size = 16, color: inputColor }: IconProps) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.text;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9}>
			<Rect x={3} y={4} width={18} height={13} rx={2} strokeLinejoin="round" />
			<Path d="M8 21h8M7 9l3 2-3 2M12 13h4" strokeLinecap="round" strokeLinejoin="round" />
		</Svg>
	);
};
export const CheckIcon = (p: IconProps) => {
	const { colors } = useAppearance();
	return <Line d="M5 12.5l4.5 4.5L19 7.5" size={18} strokeWidth={2.4} color={colors.accent} {...p} />;
};
export const FolderIcon = (p: IconProps) => (
	<Line
		d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"
		size={18}
		strokeWidth={1.9}
		{...p}
	/>
);
export const PencilIcon = (p: IconProps) => (
	<Line d="M12 20h8M4 20l1-4L16 5l3 3L8 19z" size={22} strokeWidth={1.9} {...p} />
);
/** Favorite model (Pi's scoped models): outline, filled when on. */
export const StarIcon = ({ size = 20, color: inputColor, filled }: IconProps & { filled?: boolean }) => {
	const { colors } = useAppearance();
	const color = inputColor ?? colors.textSecondary;
	return (
		<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
			<Path
				d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z"
				stroke={color}
				strokeWidth={1.8}
				strokeLinejoin="round"
				fill={filled ? color : "none"}
			/>
		</Svg>
	);
};

/** Context: a page filling with lines (Issue #59 composer gauges). */
export const ContextIcon = (p: IconProps) => (
	<Line
		d="M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9.5 8h5M9.5 12h5M9.5 16h3"
		size={12}
		strokeWidth={2.4}
		{...p}
	/>
);

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
