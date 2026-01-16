import tippy from "tippy.js";
import type SNWPlugin from "../main";
import { UPDATE_DEBOUNCE } from "../main";
import "tippy.js/dist/tippy.css";
import { Platform, debounce } from "obsidian";
import { render } from "preact";
import { getUIC_Hoverview } from "src/ui/components/uic-ref--parent";

let plugin: SNWPlugin;

export function setPluginVariableForHtmlDecorations(snwPlugin: SNWPlugin) {
	plugin = snwPlugin;
}

/**
 * Shared function between references-cm6.ts and references-preview.
 * This decoration is just the html box drawn into the document with the count of references.
 * It is used in the header as well as inline in the document. If a user clicks on this element,
 * the function processHtmlDecorationReferenceEvent is called
 *
 * @export
 * @param {number} count            Number to show in the box
 * @param {string} referenceType    The type of references (block, embed, link, header)
 * @param {string} realLink         The real link to the reference contained in the document
 * @param {string} key              Unique key used to identify this reference based on its type
 * @param {string} filePath         File path in file in vault
 * @param {string} attachCSSClass   if special class is need for the element
 * @return {*}  {HTMLElement}
 */
export function htmlDecorationForReferencesElement(
	count: number,
	referenceType: string,
	realLink: string,
	key: string,
	filePath: string,
	attachCSSClass: string,
	lineNu: number,
): HTMLElement {
	const referenceElementJsx = (
		<span
			className={`snw-reference snw-${referenceType} ${attachCSSClass}`}
			data-snw-type={referenceType}
			data-snw-reallink={realLink}
			data-snw-key={key.toLocaleUpperCase()}
			data-snw-filepath={filePath}
			snw-data-line-number={lineNu.toString()}
		>
			{count.toString()}
		</span>
	);

	const refenceElement = createSpan();
	render(referenceElementJsx, refenceElement);
	const refCountBox = refenceElement.firstElementChild as HTMLElement;

	// 1. 处理点击事件 (桌面端 或 移动端设置为侧边栏模式)
	if (Platform.isDesktop || Platform.isDesktopApp || (Platform.isMobile && plugin.settings.mobileClickAction === "sidebar")) {
		refCountBox.onclick = async (e: MouseEvent) => processHtmlDecorationReferenceEvent(e.target as HTMLElement);
	}

	// 2. 处理 Tippy 悬浮窗 (非移动端 或 移动端设置为悬浮窗模式)
	if (!Platform.isMobile || (Platform.isMobile && plugin.settings.mobileClickAction === "popover")) {
		const requireModifierKey = plugin.settings.requireModifierKeyToActivateSNWView;
		let showTippy = true;

		const tippyObject = tippy(refCountBox, {
			interactive: true,
			appendTo: () => document.body,
			allowHTML: true,
			zIndex: 9999,
			placement: "auto-end",
			// trigger: "click",
			onTrigger(instance, event) {
				const mouseEvent = event as MouseEvent;
				if (requireModifierKey === false) return;
				if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
					showTippy = true;
				} else {
					showTippy = false;
				}
			},
			onShow(instance) {
				if (!showTippy) return false;
				setTimeout(async () => {
					await getUIC_Hoverview(instance);
				}, 1);
			},
		});

		tippyObject.popper.classList.add("snw-tippy");
	}

	return refenceElement;
}

//  Opens the sidebar SNW pane by calling activateView on main.ts
export const processHtmlDecorationReferenceEvent = async (target: HTMLElement) => {
	const refType = target.getAttribute("data-snw-type") ?? "";
	const realLink = target.getAttribute("data-snw-realLink") ?? "";
	const key = target.getAttribute("data-snw-key") ?? "";
	const filePath = target.getAttribute("data-snw-filepath") ?? "";
	const lineNu = target.getAttribute("snw-data-line-number") ?? "";
	plugin.activateViewFromRef(refType, realLink, key, filePath, Number(lineNu));
};

// loops all visble references marked with the class snw-liveupdate and updates the count if needed
// or removes the element if the reference is no longer in the document
export const updateAllSnwLiveUpdateReferencesDebounce = debounce(
	() => {
		const elements = document.querySelectorAll(".snw-liveupdate");
		for (const el of Array.from(elements) as HTMLElement[]) {
			const newCount = plugin.snwAPI.references.get(el.dataset.snwKey)?.length ?? 0;
			if (newCount < plugin.settings.minimumRefCountThreshold) {
				el.remove();
				continue;
			}
			const newCountStr = String(newCount);
			if (el.textContent !== newCountStr) {
				el.textContent = newCountStr;
			}
		}
	},
	UPDATE_DEBOUNCE,
	true,
);
