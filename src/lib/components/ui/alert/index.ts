import Action from "./alert-action.svelte";
import Description from "./alert-description.svelte";
import Title from "./alert-title.svelte";
import Root from "./alert.svelte";
export { alertVariants, type AlertVariant } from "./alert.svelte";

export {
	Root,
	Description,
	Title,
	Action,
	//
	Root as Alert,
	Description as AlertDescription,
	Title as AlertTitle,
	Action as AlertAction,
};

/** Atlas's message tones onto Alert variants and their icons, for callers holding a tone in data. */
export const alertTone = {
	info: { variant: "default", icon: "info" },
	success: { variant: "success", icon: "check_circle" },
	warn: { variant: "warning", icon: "warning" },
	error: { variant: "destructive", icon: "error" },
} as const;
