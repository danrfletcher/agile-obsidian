/**
 * CSS colour check for custom template `color` / `textColor`.
 *
 * Accepted: hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba()/hsl()/hsla() with numeric
 * arguments only, and the named colour keywords (plus `transparent` and `currentcolor`).
 * Everything else is rejected, so a value can never smuggle in `;`, `url(...)`,
 * `expression(...)` or any other declaration. Values are HTML-escaped on output as well.
 */

const NAMED = new Set(
	(
		"aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue " +
		"blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk " +
		"crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki " +
		"darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
		"darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
		"dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite " +
		"gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
		"lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
		"lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen " +
		"lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen " +
		"linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple " +
		"mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
		"midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
		"orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip " +
		"peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue " +
		"saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
		"slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet " +
		"wheat white whitesmoke yellow yellowgreen transparent currentcolor"
	).split(" ")
);

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_RE = /^(rgb|rgba|hsl|hsla)\(([^()]*)\)$/i;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:%|deg|rad|grad|turn)?$/i;

export function isCssColor(value: string): boolean {
	const v = value.trim();
	if (!v || v.length > 100) return false;
	if (HEX_RE.test(v)) return true;
	if (NAMED.has(v.toLowerCase())) return true;

	const m = FUNC_RE.exec(v);
	if (!m) return false;
	const args = m[2]
		.split(/[\s,/]+/)
		.filter((a) => a.length > 0);
	if (args.length < 3 || args.length > 4) return false;
	return args.every((a) => NUMBER_RE.test(a));
}
