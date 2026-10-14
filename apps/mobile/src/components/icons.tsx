/** Line icons transcribed from the design mock SVGs (docs/design/html/*.html, 24×24 viewBox). */
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors } from "@/theme/tokens";

interface IconProps {
	size?: number;
	color?: string;
	strokeWidth?: number;
}

function Line({ d, size = 22, color = colors.text, strokeWidth = 2 }: IconProps & { d: string }) {
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
export const SearchIcon = ({ size = 16, color = colors.textSecondary }: IconProps) => (
	<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
		<Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={2} />
		<Path d="M20 20l-4.2-4.2" stroke={color} strokeWidth={2} strokeLinecap="round" />
	</Svg>
);
export const ClockIcon = ({ size = 12, color = colors.textSecondary }: IconProps) => (
	<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
		<Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
		<Path d="M12 7v5l3 2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
	</Svg>
);
export const StopIcon = ({ size = 22, color = colors.text }: IconProps) => (
	<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
		<Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
		<Rect x={9} y={9} width={6} height={6} rx={1} fill={color} />
	</Svg>
);
export const GearIcon = ({ size = 18, color = colors.textSecondary }: IconProps) => (
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
export const ServerIcon = ({ size = 15, color = colors.textSecondary }: IconProps) => (
	<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
		<Rect x={3} y={4} width={18} height={7} rx={2} stroke={color} strokeWidth={1.9} />
		<Rect x={3} y={13} width={18} height={7} rx={2} stroke={color} strokeWidth={1.9} />
		<Path d="M7 7.5h.01M7 16.5h.01" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
	</Svg>
);
export const LaptopIcon = ({ size = 15, color = colors.textSecondary }: IconProps) => (
	<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
		<Rect x={4} y={5} width={16} height={11} rx={1.5} stroke={color} strokeWidth={1.9} />
		<Path d="M2 19h20" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
	</Svg>
);
