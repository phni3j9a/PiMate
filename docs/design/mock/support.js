// 最小限のモック描画シム（元のデザインツールのランタイムの代替）。
// <script type="text/x-dc"> の Component.renderVals() の値で、
// <sc-for list as> / <sc-if value> / {{式}} を展開する。
class DCLogic {}
window.DCLogic = DCLogic;

document.addEventListener('DOMContentLoaded', () => {
	const src = document.querySelector('script[data-dc-script]');
	if (!src) return;
	const Component = new Function('DCLogic', `${src.textContent}\nreturn Component;`)(DCLogic);
	const vals = new Component().renderVals?.() ?? {};

	const evalExpr = (expr, scope) => {
		try {
			return new Function(...Object.keys(scope), `return (${expr});`)(...Object.values(scope));
		} catch {
			return '';
		}
	};
	const single = (s) => s.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/)?.[1];
	const interp = (s, scope) => s.replace(/\{\{([\s\S]+?)\}\}/g, (_, e) => {
		const v = evalExpr(e, scope);
		return v == null ? '' : String(v);
	});

	const walk = (node, scope) => {
		if (node.nodeType === Node.TEXT_NODE) {
			if (node.nodeValue.includes('{{')) node.nodeValue = interp(node.nodeValue, scope);
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const tag = node.tagName.toLowerCase();
		if (tag === 'script' || tag === 'style') return;
		if (tag === 'sc-for' || tag === 'sc-if') {
			const frag = document.createDocumentFragment();
			if (tag === 'sc-for') {
				const list = evalExpr(single(node.getAttribute('list')) ?? '[]', scope) || [];
				const as = node.getAttribute('as') || 'item';
				list.forEach((item, i) => {
					for (const child of node.childNodes) {
						const c = child.cloneNode(true);
						frag.appendChild(c);
						walk(c, { ...scope, [as]: item, index: i });
					}
				});
			} else if (evalExpr(single(node.getAttribute('value')) ?? 'false', scope)) {
				for (const child of [...node.childNodes]) {
					frag.appendChild(child);
					walk(child, scope);
				}
			}
			node.replaceWith(frag);
			return;
		}
		for (const a of [...node.attributes]) if (a.value.includes('{{')) a.value = interp(a.value, scope);
		for (const child of [...node.childNodes]) walk(child, scope);
	};
	document.querySelectorAll('x-dc').forEach((root) => walk(root, vals));
	document.querySelectorAll('helmet').forEach((h) => [...h.children].forEach((c) => document.head.appendChild(c)));
});
