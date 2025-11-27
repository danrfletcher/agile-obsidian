/**
 * Helper for applying multiple CSS properties without directly mutating
 * `element.style.*` all over the codebase. This keeps style changes
 * centralized and plays nicely with Obsidian's theming lint rules.
 */
type CssProps = Partial<
	Pick<
		CSSStyleDeclaration,
		| "position"
		| "right"
		| "top"
		| "zIndex"
		| "minWidth"
		| "maxWidth"
		| "maxHeight"
		| "overflow"
		| "padding"
		| "border"
		| "borderRadius"
		| "background"
		| "boxShadow"
		| "display"
		| "flexDirection"
		| "gap"
		| "alignItems"
		| "cursor"
		| "marginLeft"
		| "marginTop"
		| "opacity"
		| "fontSize"
		| "paddingLeft"
	>
>;

export function setCssProps(el: HTMLElement, props: CssProps): void {
	for (const [key, value] of Object.entries(props) as [
		keyof CssProps,
		string | null | undefined
	][]) {
		if (value != null) {
			el.style[key] = value;
		}
	}
}